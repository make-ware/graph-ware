// PocketBase JavaScript Hooks
// Documentation: https://pocketbase.io/docs/js-overview/

// Example: Custom API endpoint
routerAdd("GET", "/api/hello", (c) => {
  return c.json(200, {
    "message": "Hello from PocketBase!",
    "timestamp": new Date().toISOString()
  })
})

// Example: Validate user registration (before creation)
onRecordCreateRequest((e) => {
  if (e.record.tableName() === "users") {
    // Add custom validation logic here
    console.log("👤 New user registration:", e.record.get("email"))
  }
  e.next()
}, "users")

// Example: Send welcome email after user creation
onRecordCreate((e) => {
  if (e.record.tableName() === "users") {
    // Add email sending logic here
    console.log("📧 Welcome email should be sent to:", e.record.get("email"))
  }
}, "users")