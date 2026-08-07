/* eslint-disable no-console */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const DB_URL = process.env.DATABASE_URL;

const AdminSchema = new mongoose.Schema(
    {
        first_name: { type: String, required: true },
        last_name: { type: String, required: true },
        email: { type: String, required: true, unique: true, lowercase: true },
        phone_number: { type: String },
        password_hash: { type: String, required: true },
        role: {
            type: String,
            enum: ['super_admin', 'moderator'],
            default: 'moderator',
            required: true,
        },
    },
    { timestamps: true, collection: 'admins' },
);

const Admin = mongoose.model('AdminSeed', AdminSchema, 'admins');

async function run() {
    if (!DB_URL) {
        throw new Error('DATABASE_URL is missing in .env');
    }

    const [email, password, firstName = 'System', lastName = 'Admin', role = 'super_admin', phoneNumber = ''] =
        process.argv.slice(2);

    if (!email || !password) {
        throw new Error(
            'Usage: node scripts/seed-admin.js <email> <password> [firstName] [lastName] [role] [phoneNumber]',
        );
    }

    if (!['super_admin', 'moderator'].includes(role)) {
        throw new Error('role must be either super_admin or moderator');
    }

    await mongoose.connect(DB_URL);

    const password_hash = await bcrypt.hash(password, 10);

    const existing = await Admin.findOne({ email: email.toLowerCase() });

    if (existing) {
        existing.first_name = firstName;
        existing.last_name = lastName;
        existing.phone_number = phoneNumber;
        existing.role = role;
        existing.password_hash = password_hash;
        await existing.save();
        console.log(`Updated admin: ${existing.email}`);
    } else {
        const created = await Admin.create({
            first_name: firstName,
            last_name: lastName,
            email: email.toLowerCase(),
            phone_number: phoneNumber,
            role,
            password_hash,
        });
        console.log(`Created admin: ${created.email}`);
    }

    await mongoose.disconnect();
}

run()
    .then(() => {
        console.log('Done');
        process.exit(0);
    })
    .catch(async (error) => {
        console.error(error.message || error);
        try {
            await mongoose.disconnect();
        } catch { }
        process.exit(1);
    });
