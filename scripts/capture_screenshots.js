import puppeteer from 'puppeteer-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUTPUT_DIR = path.resolve('docs/screenshots');

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    defaultViewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1.5,
    },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  const page = await browser.newPage();

  console.log('1. Navigating to Login...');
  await page.goto('http://127.0.0.1:5173/login', { waitUntil: 'networkidle0' });

  // Sign in as Dev Member (who has member, organizer, treasurer roles)
  console.log('2. Signing in as dev-member@example.local...');
  await page.type('#email', 'dev-member@example.local');
  await page.type('#password', 'Dev$Member1!');
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle0' });
  console.log('Logged in successfully!');

  // Helper to capture a screenshot
  async function snap(route, filename, delayMs = 600) {
    console.log(`Capturing ${filename} (${route})...`);
    await page.goto(`http://127.0.0.1:5173${route}`, { waitUntil: 'networkidle0' });
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    await page.screenshot({
      path: path.join(OUTPUT_DIR, filename),
      fullPage: false,
    });
  }

  // 1. Home / Landing Hero
  await snap('/', '01_home_landing.png');

  // 2. Events Directory
  await snap('/events', '02_events_catalog.png');

  // 3. Event Details
  await snap('/events/40000000-0000-0000-0000-000000000001', '03_event_details.png');

  // 4. My Tickets (with QR & Admission Code)
  await snap('/tickets', '04_my_tickets.png');

  // 5. Staff Check-In Kiosk & Attendance
  await snap('/staff/checkin', '05_staff_checkin_kiosk.png');

  // 6. Merchandise Shop
  await snap('/shop', '06_merchandise_shop.png');

  // 7. Product Detail
  await snap('/shop/60000000-0000-0000-0000-000000000001', '07_product_detail.png');

  // 8. Orders Management
  await snap('/orders', '08_orders_management.png');

  // 9. Order Detail
  // Find first order link from orders page
  const orderLink = await page.evaluate(() => {
    const a = document.querySelector('a[href^="/orders/"]');
    return a ? a.getAttribute('href') : '/orders/80000000-0000-0000-0000-000000000001';
  });
  await snap(orderLink, '09_order_detail.png');

  // 10. Staff Inventory & Pickup Desk
  await snap('/staff/inventory', '10_staff_inventory.png');

  // 11. Student Membership Portal
  await snap('/membership', '11_membership_portal.png');

  // 12. Staff Member Directory
  await snap('/members', '12_member_directory.png');

  // 13. Staff Membership Dues Verification Desk
  await snap('/staff/dues', '13_staff_dues.png');

  // 14. Staff Pending Payments Confirmation Desk
  await snap('/staff/payments', '14_staff_payments.png');

  // 15. Financial Treasury & Executive Balance Sheet
  await snap('/finance', '15_finance_treasury.png');

  // 16. Volunteer Tasks Board
  await snap('/tasks', '16_volunteer_tasks.png');

  // 17. Expense Claims & Reimbursements
  await snap('/expenses', '17_expense_claims.png');

  // 18. Community Announcements
  await snap('/announcements', '18_announcements.png');

  // 19. Community Mail Outbox Logs
  await snap('/staff/mail', '19_mail_outbox.png');

  // 20. Global Search & Explorer
  await snap('/search?q=symposium', '20_search_explorer.png');

  console.log('✅ All 20 high-resolution screenshots captured successfully!');
  await browser.close();
}

main().catch((err) => {
  console.error('Error capturing screenshots:', err);
  process.exit(1);
});
