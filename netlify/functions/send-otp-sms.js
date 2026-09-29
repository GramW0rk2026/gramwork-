// این نسخه با قبلی یه فرق اساسی داره: کد تأیید دیگه تو مرورگر کاربر ساخته
// نمی‌شه و دیگه از مرورگر مستقیم تو دیتابیس درج نمی‌شه (چون هرکسی می‌تونست
// برای هر شماره‌ای کد دلخواه خودش رو ثبت کنه و بدون پیامک وارد بشه).
// حالا کد همین‌جا، رو سرور، ساخته و با کلید سرویس (service role) که RLS رو
// دور می‌زنه، ذخیره می‌شه — مرورگر فقط شماره رو می‌فرسته، نه کد رو.
exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { phone } = JSON.parse(event.body || '{}');

    if (!phone || phone.length !== 11 || !phone.startsWith('09')) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'شماره نامعتبر است' }) };
    }

    const apiKey = process.env.KAVENEGAR_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!apiKey || !supabaseUrl || !serviceKey) {
      return { statusCode: 500, body: JSON.stringify({ success: false, error: 'تنظیمات سرور کامل نیست (KAVENEGAR_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)' }) };
    }

    const code = Math.floor(10000 + Math.random() * 90000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const restHeaders = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    };

    // کدهای قبلیِ همین شماره رو پاک می‌کنیم
    await fetch(`${supabaseUrl}/rest/v1/otps?phone=eq.${encodeURIComponent(phone)}`, {
      method: 'DELETE',
      headers: { ...restHeaders, Prefer: 'return=minimal' }
    });

    // کد تازه رو ذخیره می‌کنیم — این درخواست با کلید سرویس می‌ره، پس RLS بهش کاری نداره
    const insertRes = await fetch(`${supabaseUrl}/rest/v1/otps`, {
      method: 'POST',
      headers: { ...restHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ phone, code, expires_at: expiresAt })
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      return { statusCode: 500, body: JSON.stringify({ success: false, error: 'خطا در ذخیره کد: ' + errText }) };
    }

    const template = 'gramwork-otp-code';
    const smsUrl = `https://api.kavenegar.com/v1/${apiKey}/verify/lookup.json?receptor=${encodeURIComponent(phone)}&token=${encodeURIComponent(code)}&template=${encodeURIComponent(template)}`;

    const res = await fetch(smsUrl);
    const data = await res.json();

    if (data && data.return && data.return.status === 200) {
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 500, body: JSON.stringify({ success: false, error: data }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
