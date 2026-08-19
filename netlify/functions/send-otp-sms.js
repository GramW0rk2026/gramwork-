exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { phone, code } = JSON.parse(event.body || '{}');

    if (!phone || !code || phone.length !== 11 || !phone.startsWith('09')) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'شماره یا کد نامعتبر است' }) };
    }

    const apiKey = process.env.KAVENEGAR_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ success: false, error: 'کلید API روی سرور تنظیم نشده' }) };
    }

    const template = 'gramwork-otp-code';
    const url = `https://api.kavenegar.com/v1/${apiKey}/verify/lookup.json?receptor=${encodeURIComponent(phone)}&token=${encodeURIComponent(code)}&template=${encodeURIComponent(template)}`;

    const res = await fetch(url);
    const data = await res.json();

    if (data && data.return && data.return.status === 200) {
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 500, body: JSON.stringify({ success: false, error: data }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
