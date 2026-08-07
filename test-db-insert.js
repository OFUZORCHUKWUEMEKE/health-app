const mongoose = require('mongoose');
mongoose.connect('mongodb+srv://ofuzor:ofuzor2018@cluster0.qjl8f.mongodb.net/health_app_dev?retryWrites=true&w=majority')
.then(async () => {
    const Appointment = mongoose.model('Appointment', new mongoose.Schema({
        appointment_number: String,
        status: String,
        patient_id: mongoose.Types.ObjectId,
        scheduled_start_at_utc: Date
    }, { collection: 'appointments' }));
    
    // Insert dummy history for APT-20260422-9141
    await Appointment.create({
        appointment_number: "APT-20260422-9141",
        status: "RESCHEDULED",
        patient_id: new mongoose.Types.ObjectId("67e0609c3e18d1c4825314f2"),
        scheduled_start_at_utc: new Date("2026-04-20T10:00:00.000Z")
    });
    
    console.log("Inserted!");
    process.exit(0);
})
.catch(err => {
    console.error(err);
    process.exit(1);
});
