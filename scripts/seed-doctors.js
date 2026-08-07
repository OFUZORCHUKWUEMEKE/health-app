/* eslint-disable no-console */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const DB_URL = process.env.DATABASE_URL;

const DoctorSchema = new mongoose.Schema(
    {
        doctor_no: { type: String, required: true, unique: true },
        first_name: { type: String, required: true },
        last_name: { type: String, required: true },
        full_name: { type: String },
        email: { type: String, required: true, unique: true, lowercase: true },
        phone_number: { type: String },
        password_hash: { type: String, required: true },
        active: { type: Boolean, default: true },
        profile_picture_url: { type: String },
        specializations: { type: [String], default: [] },
        license_no: { type: String, unique: true, sparse: true },
        refresh_token_hash: { type: String },
    },
    { timestamps: true, collection: 'doctors' },
);

const Doctor = mongoose.model('DoctorSeed', DoctorSchema, 'doctors');

// ─── Seed Data ───────────────────────────────────────────────────────────────
const DOCTORS = [
    {
        first_name: 'Emeka',
        last_name: 'Okafor',
        email: 'emeka.okafor@mediapp.com',
        phone_number: '+2348031234567',
        specializations: ['General Practice', 'Family Medicine'],
        license_no: 'MDCN-2019-001',
    },
    {
        first_name: 'Amaka',
        last_name: 'Nwosu',
        email: 'amaka.nwosu@mediapp.com',
        phone_number: '+2348031234568',
        specializations: ['Pediatrics'],
        license_no: 'MDCN-2019-002',
    },
    {
        first_name: 'Chidi',
        last_name: 'Eze',
        email: 'chidi.eze@mediapp.com',
        phone_number: '+2348031234569',
        specializations: ['Cardiology', 'Internal Medicine'],
        license_no: 'MDCN-2020-003',
    },
    {
        first_name: 'Ngozi',
        last_name: 'Adeyemi',
        email: 'ngozi.adeyemi@mediapp.com',
        phone_number: '+2348031234570',
        specializations: ['Obstetrics', 'Gynecology'],
        license_no: 'MDCN-2020-004',
    },
    {
        first_name: 'Tunde',
        last_name: 'Balogun',
        email: 'tunde.balogun@mediapp.com',
        phone_number: '+2348031234571',
        specializations: ['Orthopedics', 'Sports Medicine'],
        license_no: 'MDCN-2021-005',
    },
    {
        first_name: 'Fatima',
        last_name: 'Aliyu',
        email: 'fatima.aliyu@mediapp.com',
        phone_number: '+2348031234572',
        specializations: ['Dermatology'],
        license_no: 'MDCN-2021-006',
    },
    {
        first_name: 'Kunle',
        last_name: 'Adesanya',
        email: 'kunle.adesanya@mediapp.com',
        phone_number: '+2348031234573',
        specializations: ['Psychiatry', 'Mental Health'],
        license_no: 'MDCN-2022-007',
    },
    {
        first_name: 'Ifeoma',
        last_name: 'Onuoha',
        email: 'ifeoma.onuoha@mediapp.com',
        phone_number: '+2348031234574',
        specializations: ['Ophthalmology'],
        license_no: 'MDCN-2022-008',
    },
    {
        first_name: 'Segun',
        last_name: 'Martins',
        email: 'segun.martins@mediapp.com',
        phone_number: '+2348031234575',
        specializations: ['ENT', 'General Surgery'],
        license_no: 'MDCN-2023-009',
    },
    {
        first_name: 'Blessing',
        last_name: 'Okoro',
        email: 'blessing.okoro@mediapp.com',
        phone_number: '+2348031234576',
        specializations: ['Neurology'],
        license_no: 'MDCN-2023-010',
    },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function generateDoctorNo() {
    return `DOC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

// ─── Runner ───────────────────────────────────────────────────────────────────
async function run() {
    if (!DB_URL) {
        throw new Error('DATABASE_URL is missing in .env');
    }

    // Allow overriding the default password via CLI: node seed-doctors.js <password>
    const defaultPassword = process.argv[2] || 'Doctor@1234';

    console.log(`Connecting to DB...`);
    await mongoose.connect(DB_URL);
    console.log('Connected.\n');

    let created = 0;
    let updated = 0;

    for (const doc of DOCTORS) {
        const password_hash = await bcrypt.hash(defaultPassword, 10);
        const full_name = `${doc.first_name} ${doc.last_name}`;

        const existing = await Doctor.findOne({ email: doc.email.toLowerCase() });

        if (existing) {
            existing.first_name = doc.first_name;
            existing.last_name = doc.last_name;
            existing.full_name = full_name;
            existing.phone_number = doc.phone_number;
            existing.specializations = doc.specializations;
            existing.license_no = doc.license_no;
            existing.password_hash = password_hash;
            existing.active = true;
            await existing.save();
            console.log(`  ✔ Updated : ${existing.email}`);
            updated++;
        } else {
            const created_doc = await Doctor.create({
                ...doc,
                email: doc.email.toLowerCase(),
                full_name,
                password_hash,
                doctor_no: generateDoctorNo(),
                active: true,
            });
            console.log(`  ✔ Created : ${created_doc.email}`);
            created++;
        }
    }

    await mongoose.disconnect();

    console.log(`\n─────────────────────────────────────`);
    console.log(`  Created : ${created}`);
    console.log(`  Updated : ${updated}`);
    console.log(`  Total   : ${DOCTORS.length}`);
    console.log(`  Password: ${defaultPassword}`);
    console.log(`─────────────────────────────────────`);
}

run()
    .then(() => {
        console.log('\nDone ✅');
        process.exit(0);
    })
    .catch(async (error) => {
        console.error('\n❌ Error:', error.message || error);
        await mongoose.disconnect().catch(() => { });
        process.exit(1);
    });
