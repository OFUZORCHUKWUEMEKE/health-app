const mongoose = require('mongoose');
mongoose.connect('mongodb+srv://ofuzor:ofuzor2018@cluster0.qjl8f.mongodb.net/health_app_dev?retryWrites=true&w=majority')
.then(async () => {
    const Appointment = mongoose.model('Appointment', new mongoose.Schema({
        appointment_number: String,
        status: String
    }, { collection: 'appointments' }));
    
    // Find ANY rescheduled appointments
    const docs = await Appointment.find({ status: "RESCHEDULED" }).limit(5).lean();
    console.log("Rescheduled appointments:");
    docs.forEach(d => {
        console.log(`ID: ${d._id}, NUM: ${d.appointment_number}`);
    });
    
    const count = await Appointment.countDocuments({ status: "RESCHEDULED" });
    console.log("Total rescheduled:", count);
    
    process.exit(0);
})
.catch(err => {
    console.error(err);
    process.exit(1);
});
