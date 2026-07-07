import { chromium } from 'playwright';

async function runTeamshipWorkflow() {
  console.log('🚀 Starting Teamship automation engine...');
  
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized']
  });

  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  try {
    // 1. Load the Portal
    console.log('🌐 Opening Teamship portal...');
    await page.goto('https://teamship.newl.ca/login', { waitUntil: 'networkidle' });

    // 2. Authentication Block
    console.log('⌨️ Entering account credentials...');
    
    // Target the fields based on their type attributes
    await page.locator('#app main input[type="text"], input[type="email"], input').first().fill('faisal.haroon@newl.ca');
    await page.locator('#app main input[type="password"]').fill('123456');

    console.log('🖱️ Clicking login submit button...');
    await page.locator('#app main div.my-7 > button').click();

    // 🔄 3. Navigating to Quotes via Text Target
    console.log('⏳ Waiting for navigation bar to settle...');
    
    // Instead of a giant path, we look directly for the navigation link that says "Quotes"
    const quotesNavLink = page.locator('header nav a, header nav li').filter({ hasText: /^Quotes$/i }).first();
    await quotesNavLink.waitFor({ state: 'visible', timeout: 15000 });
    
    console.log('🖱️ Clicking the \"Quotes\" navigation option...');
    await quotesNavLink.click();

    // 🔄 4. Trigger Add Quote Button via Text Target
    console.log('⏳ Waiting for the Quotes page workspace to load...');
    
    // We target any link or button on the page that literally displays the text "Add a quote"
    const addQuoteButton = page.locator('a, button').filter({ hasText: /Add a quote/i }).first();
    
    console.log('👀 Searching for \"Add a quote\" text element on the page...');
    await addQuoteButton.waitFor({ state: 'visible', timeout: 15000 });
    
    console.log('➕ Clicking \"Add a Quote\" button...');
    await addQuoteButton.click();

    // 5. Handling the Customer Search Dropdown
    console.log('⏳ Synchronizing with dynamic Customer Lookup field...');
    
    // Let's look specifically for the Vue Multiselect block on the new quote page
    const customerDropdown = page.locator('.multiselect__tags').first();
    await customerDropdown.waitFor({ state: 'visible', timeout: 15000 });
    await customerDropdown.click();

    console.log('⌨️ Simulation-typing customer search string...');
    await page.locator('.multiselect__input').first().pressSequentially('ACME Logistics', { delay: 100 });

    // Hold screen open so we can verify the search results
    await page.waitForTimeout(15000);

  } catch (error) {
    console.error('❌ Automation sequence broken:', error);
    // This saves a picture of exactly what was on your screen the millisecond it failed
    await page.screenshot({ path: 'teamship-diagnostic-capture.png' });
    console.log('📸 Diagnostic screenshot saved to teamship-diagnostic-capture.png');
  } finally {
    // Keeps the browser window resting for 60 seconds so you can look at it
    await page.waitForTimeout(60000);
    await browser.close();
    console.log('🔒 Instance destroyed.');
  }
}

runTeamshipWorkflow();