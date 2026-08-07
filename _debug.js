const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

(async () => {
  await mongoose.connect(process.env.DATABASE_URL);
  const db = mongoose.connection.db;

  const pid = new mongoose.Types.ObjectId('67e0609c3e18d1c4825314f2');

  // Check investigation list docs for this patient
  const invs = await db.collection('investigationlists').find({ user_id: pid }).toArray();

  console.log('InvestigationList consultation_id types:\n');
  for (const inv of invs) {
    const cid = inv.consultation_id;
    const isOid = cid instanceof mongoose.Types.ObjectId;
    const rawType = typeof cid;
    console.log(`  inv=${inv._id} name="${inv.name}"`);
    console.log(`    consultation_id=${cid} typeof=${rawType} isObjectId=${isOid}`);
    console.log(`    constructor=${cid?.constructor?.name}`);

    // Try direct lookup
    const found = await db.collection('consultations').findOne({ _id: cid });
    console.log(`    direct lookup: ${found ? 'FOUND' : 'NOT FOUND'}`);

    // Try with explicit cast
    const asOid = new mongoose.Types.ObjectId(cid.toString());
    const found2 = await db.collection('consultations').findOne({ _id: asOid });
    console.log(`    cast lookup: ${found2 ? 'FOUND' : 'NOT FOUND'}`);
    console.log('');
  }

  // Now compare with patient who WORKS (67e0583247709d6011b6be8c)
  const workingPid = new mongoose.Types.ObjectId('67e0583247709d6011b6be8c');
  const workingInvs = await db.collection('investigationlists').find({ user_id: workingPid }).limit(1).toArray();
  if (workingInvs.length) {
    const w = workingInvs[0];
    console.log('Working patient investigation for comparison:');
    console.log(`  consultation_id=${w.consultation_id} typeof=${typeof w.consultation_id} isObjectId=${w.consultation_id instanceof mongoose.Types.ObjectId} constructor=${w.consultation_id?.constructor?.name}`);
  }

  await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });