import * as dotenv from 'dotenv';
dotenv.config();

export default () => ({
    port: process.env.PORT || 3000,
    db_url: process.env.DATABASE_URL,
    jwt: {
        secret: process.env.JWT_SECRET,
        expiresIn: process.env.JWT_EXPIRES_IN,
    },
    daily: {
        api_key: process.env.DAILY_API_KEY,
        webhook_hmac_secret: process.env.DAILY_WEBHOOK_HMAC_SECRET,
    },
    mail: {
        username: process.env.EMAIL_USER,
        host: process.env.EMAIL_HOST,
        password: process.env.EMAIL_PASSWORD,
        port: Number(process.env.EMAIL_PORT || 2525),
        secure:
            (process.env.EMAIL_SECURE || 'false').toLowerCase() === 'true',
        from: process.env.EMAIL_FROM || '"Health App" <noreply@healthapp.local>',
    },
})