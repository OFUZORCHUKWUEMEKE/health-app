const fs = require('fs');
const execSync = require('child_process').execSync;

function run(cmd) {
    try {
        return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
        return e.stdout + e.stderr;
    }
}

// 1. Get token
const loginCmd = `curl -s -X POST http://localhost:3000/api/v1/auth/patients/login -H "Content-Type: application/json" -d '{"email": "wizzywizpad@gmail.com", "password": "Wisdom@123"}'`;
const loginRes = JSON.parse(run(loginCmd));
const token = loginRes.data?.token;

if (!token) {
    console.log("No token", loginRes);
    process.exit(1);
}

// 2. Fetch doctors to get one to book
const docCmd = `curl -s http://localhost:3000/api/v1/booking/doctors/available -H "Authorization: Bearer ${token}"`;
const docRes = JSON.parse(run(docCmd));
const docId = docRes.data?.[0]?._id;

// 3. Create appointment
const date = new Date(Date.now() + 86400000 * 20); // 20 days later
const isoDateStr = date.toISOString().split('T')[0];
const createCmd = `curl -s -X POST http://localhost:3000/api/v1/booking/patients/appointments -H "Content-Type: application/json" -H "Authorization: Bearer ${token}" -d '{
  "first_name": "Wisdom",
  "last_name": "O",
  "date_of_birth": "1990-01-01",
  "gender": "male",
  "marital_status": "single",
  "occupation": "dev",
  "present_complaint": "test",
  "Medical_conditions": [],
  "allergies": [],
  "doctor_id": "${docId}",
  "scheduled_start_local": "${isoDateStr}T10:00:00",
  "timezone": "UTC",
  "requested_duration_minutes": 15,
  "confirm_appointment": true
}'`;
const apptRes = JSON.parse(run(createCmd));
const apptId = apptRes.data?._id;
console.log("Created appt:", apptId, apptRes.data?.appointment_number);

// 4. Reschedule it
const reschCmd = `curl -s -X PATCH http://localhost:3000/api/v1/booking/patients/appointments/${apptId}/reschedule -H "Content-Type: application/json" -H "Authorization: Bearer ${token}" -d '{
  "scheduled_start_local": "${isoDateStr}T11:00:00",
  "timezone": "UTC",
  "requested_duration_minutes": 15,
  "reason": "Test reschedule"
}'`;
const reschRes = JSON.parse(run(reschCmd));
console.log("Rescheduled to new appt:", reschRes.data?.new_appointment?._id, reschRes.data?.new_appointment?.appointment_number);

// 5. Fetch appointments
const fetchCmd = `curl -s http://localhost:3000/api/v1/booking/patients/appointments -H "Authorization: Bearer ${token}"`;
const fetchRes = JSON.parse(run(fetchCmd));

// Check history for the newly created appointment
const newApptId = reschRes.data?.new_appointment?._id;
const fetchedItem = fetchRes.data?.items?.find(i => i._id === newApptId);
console.log("Fetched item history length:", fetchedItem?.rescheduled_history?.length);
if (fetchedItem?.rescheduled_history?.length > 0) {
    console.log("History item ID:", fetchedItem.rescheduled_history[0]._id, "Status:", fetchedItem.rescheduled_history[0].status);
} else {
    console.log("Item:", fetchedItem);
}

