const mongoose = require('mongoose');
mongoose.connect('mongodb+srv://Emeka:Emeka1234@cluster0.ngj0u.mongodb.net/health-app?retryWrites=true&w=majority', { useNewUrlParser: true, useUnifiedTopology: true })
.then(async () => {
    const Appointment = mongoose.model('Appointment', new mongoose.Schema({}, { strict: false }));
    const doc = await Appointment.findById('69d430b3e7e5302eafa9c4db');
    console.log("Old appointment:", doc);
    const newDoc = await Appointment.findById('69d430eae7e5302eafa9c4fc');
    console.log("New appointment:", newDoc);
    process.exit(0);
})
.catch(console.error);
