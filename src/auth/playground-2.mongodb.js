// MongoDB Playground
// Use Ctrl+Space inside a snippet or a string literal to trigger completions.

// The current database to use.
use("health_app_dev");

db.getCollection('consultations').getIndexes()

db.getCollection('consultations').dropIndex("id_1")

