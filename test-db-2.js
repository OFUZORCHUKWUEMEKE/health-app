const mongoose = require('mongoose');
mongoose.connect('mongodb+srv://Emeka:Emeka1234@cluster0.ngj0u.mongodb.net/health-app-backend?retryWrites=true&w=majority')
.then(async () => {
    const Appointment = mongoose.model('Appointment', new mongoose.Schema({
        appointment_number: String,
        status: String
    }, { collection: 'appointments' }));
    
    const doc = await Appointment.findById('69d430b3e7e5302eafa9c4db').lean();
    console.log("Old appointment status:", doc?.status, "number:", doc?.appointment_number);
    
    const newDoc = await Appointment.findById('69d430eae7e5302eafa9c4fc').lean();
    console.log("New appointment status:", newDoc?.status, "number:", newDoc?.appointment_number);
    
    process.exit(0);
})
.catch(err => {
    console.error(err);
    process.exit(1);
});
