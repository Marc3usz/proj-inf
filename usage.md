# TrackFlow MVP – Demo Usage Guide

Welcome to the TrackFlow MVP demo! This document is designed to help you and your testers navigate the system, understand the core features, and test the link shortening and analytics capabilities.

## 🌐 Accessing the Demo

- **Web Dashboard (Frontend):** `https://[YOUR_WEB_DOMAIN]`
- **API Base URL (For Redirects):** `https://[YOUR_API_DOMAIN]`

*(Note to deployer: Replace the placeholders above with your actual Railway domains before sharing this guide).*

---

## 🔐 Test Accounts

Since this is an MVP designed for internal agency use, public registration is intentionally disabled. The database has been pre-seeded with test accounts representing different roles within the system.

You can log in at the Web Dashboard using any of the following credentials:

| Role | Email | Password | What they can do |
| :--- | :--- | :--- | :--- |
| **Agency Admin** | `admin@test.com` | `test123` | Full access to the agency, all clients, campaigns, links, and system settings. |
| **Marketer** | `marketer@test.com` | `test123` | Can manage campaigns and links, but cannot manage other users. |
| **Client** | `client@test.com` | `test123` | Read-only access to their specific campaigns and analytics. Cannot create links. |

---

## 🧪 Testing Scenarios (Walkthrough)

Here is a step-by-step guide to testing the core functionality of the MVP.

### 1. Log in and Explore the Dashboard
1. Go to the Web Dashboard.
2. Log in as the **Agency Admin** (`admin@test.com` / `test123`).
3. You will see an overview of total clicks, active campaigns, and recent activity. (The system is pre-seeded with 100 historical clicks so the charts won't be empty).

### 2. Create a Client and Campaign
1. Navigate to the **Clients** tab and create a new client (e.g., "Acme Corp").
2. Navigate to the **Campaigns** tab and create a new campaign for that client (e.g., "Summer Sale 2024"). 

### 3. Generate a Short Link
1. Go to the **Links** tab and click "Create Link".
2. Assign it to the campaign you just created.
3. Enter a destination URL (e.g., `https://example.com/summer-sale`).
4. Set an expiration date.
5. Save. The system will generate a unique short code in the format `XXX-XXX`.

### 4. Test the High-Speed Redirect
1. Copy the generated short link (it will look something like `https://[YOUR_API_DOMAIN]/1X2-d4F`).
2. Open a new incognito window or browser tab, and paste the URL.
3. You will be instantly redirected to the destination URL.
   * *Behind the scenes:* The system hits a Redis cache, drops a message into a RabbitMQ queue for asynchronous analytics processing, and redirects you in under 80 milliseconds.

### 5. Verify Analytics Tracking
1. Go back to your TrackFlow Web Dashboard.
2. Refresh the page or navigate to the Analytics/Stats section for your link.
3. You should see your new click registered, complete with parsed User-Agent data (Browser, OS, Device) and Geographic location (based on IP address).

### 6. Test PDF Reports
1. Navigate to the **Reports** section.
2. Request a report for a specific campaign or client.
3. The background worker will generate a PDF summarizing the performance and make it available for download.

---

## 🛠 Technical Notes for Testers

* **Performance:** The redirect endpoint is built on Fastify and Redis specifically to ensure ultra-low latency. It avoids hitting the main PostgreSQL database during the redirect phase.
* **Background Processing:** Analytics parsing (IP geolocation, User-Agent parsing) and email sending are offloaded to a background worker via RabbitMQ, ensuring the redirect is never slowed down by heavy computations.
* **Tenancy:** If you log in as the `client@test.com` user, notice that you are strictly siloed. You will only see data pertaining to that specific client, demonstrating the multi-tenant architecture.