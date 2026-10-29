// ارسال کد تأیید — کد و ذخیره‌اش کاملاً سمت سرور انجام می‌شه (مرورگر فقط شماره رو می‌فرسته).
// محدودیت‌ها برای جلوگیری از سوءاستفاده و خالی‌شدن اعتبار پیامک:
//  - بین دو ارسال برای یک شماره حداقل ۶۰ ثانیه
//  - هر شماره حداکثر ۵ ارسال در ساعت
//  - هر IP حداکثر ۱۰ ارسال در ساعت
//  - کل سایت حداکثر ۲۰۰ ارسال در ساعت
const LIMITS = { cooldownSec: 60, perPhoneHour: 5, perIpHour: 10, globalHour: 200 };

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const fail = (status, msg) => ({ statusCode: status, body: JSON.stringify({ success: false, error: msg }) });

  try {
    const { phone } = JSON.parse(event.body || '{}');

    if (!phone || typeof phone !== 'string' || !/^09\d{9}$/.test(phone)) {
      return fail(400, 'شماره نامعتبر است');
    }

    const apiKey = process.env.KAVENEGAR_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!apiKey || !supabaseUrl || !serviceKey) {
      return fail(500, 'تنظیمات سرور کامل نیست (KAVENEGAR_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    }

    const h = event.headers || {};
    const ip = (h['x-nf-client-connection-ip'] || (h['x-forwarded-for'] || '').split(',')[0] || 'unknown').trim();

    const restHeaders = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    };

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    // تعداد ردیف‌های لاگ که با فیلتر می‌خونن (از هدر content-range)
    async function countLog(filter) {
      const r = await fetch(`${supabaseUrl}/rest/v1/otp_log?select=id&${filter}`, {
        headers: { ...restHeaders, Prefer: 'count=exact', Range: '0-0' }
      });
      const range = r.headers.get('content-range') || '';
      const n = parseInt(range.split('/')[1], 10);
      return isNaN(n) ? 0 : n;
    }

    // --- محدودیت‌ها ---
    const lastRes = await fetch(`${supabaseUrl}/rest/v1/otp_log?select=created_at&phone=eq.${encodeURIComponent(phone)}&order=created_at.desc&limit=1`, { headers: restHeaders });
    const lastRows = lastRes.ok ? await lastRes.json() : [];
    if (lastRows.length) {
      const waited = (Date.now() - new Date(lastRows[0].created_at).getTime()) / 1000;
      if (waited < LIMITS.cooldownSec) {
        return fail(429, `لطفاً ${Math.ceil(LIMITS.cooldownSec - waited)} ثانیه صبر کن و دوباره امتحان کن`);
      }
    }
    if (await countLog(`phone=eq.${encodeURIComponent(phone)}&created_at=gte.${hourAgo}`) >= LIMITS.perPhoneHour) {
      return fail(429, 'تعداد درخواست کد برای این شماره زیاد بود — یک ساعت دیگه دوباره امتحان کن');
    }
    if (ip !== 'unknown' && await countLog(`ip=eq.${encodeURIComponent(ip)}&created_at=gte.${hourAgo}`) >= LIMITS.perIpHour) {
      return fail(429, 'تعداد درخواست‌ها از این شبکه زیاد بود — کمی بعد دوباره امتحان کن');
    }
    if (await countLog(`created_at=gte.${hourAgo}`) >= LIMITS.globalHour) {
      return fail(429, 'سرویس موقتاً شلوغه — چند دقیقه دیگه دوباره امتحان کن');
    }

    // ثبت درخواست (قبل از ارسال، تا حتی اگه پیامک خطا بده هم شمرده بشه) + پاک‌سازی لاگ قدیمی
    await fetch(`${supabaseUrl}/rest/v1/otp_log`, {
      method: 'POST',
      headers: { ...restHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ phone, ip })
    });
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await fetch(`${supabaseUrl}/rest/v1/otp_log?created_at=lt.${dayAgo}`, {
      method: 'DELETE',
      headers: { ...restHeaders, Prefer: 'return=minimal' }
    });

    // --- ساخت و ذخیره‌ی کد ---
    const code = Math.floor(10000 + Math.random() * 90000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    await fetch(`${supabaseUrl}/rest/v1/otps?phone=eq.${encodeURIComponent(phone)}`, {
      method: 'DELETE',
      headers: { ...restHeaders, Prefer: 'return=minimal' }
    });

    const insertRes = await fetch(`${supabaseUrl}/rest/v1/otps`, {
      method: 'POST',
      headers: { ...restHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ phone, code, expires_at: expiresAt })
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      return fail(500, 'خطا در ذخیره کد: ' + errText);
    }

    // --- ارسال پیامک ---
    const template = 'gramwork-otp-code';
    const smsUrl = `https://api.kavenegar.com/v1/${apiKey}/verify/lookup.json?receptor=${encodeURIComponent(phone)}&token=${encodeURIComponent(code)}&template=${encodeURIComponent(template)}`;

    const res = await fetch(smsUrl);
    const data = await res.json();

    if (data && data.return && data.return.status === 200) {
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    return fail(500, JSON.stringify(data));
  } catch (err) {
    return fail(500, err.message);
  }
};
