import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  
  await page.goto('http://localhost:5174/login', { waitUntil: 'networkidle2' });
  
  // Set auth state locally
  await page.evaluate(() => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', JSON.stringify({ id: '1', name: 'Test' }));
  });
  
  console.log('Navigating to sequences...');
  await page.goto('http://localhost:5174/sequences', { waitUntil: 'networkidle2' });
  
  console.log('Navigating to dashboard...');
  await page.goto('http://localhost:5174/dashboard', { waitUntil: 'networkidle2' });
  
  console.log('Navigating back to sequences...');
  await page.goto('http://localhost:5174/sequences', { waitUntil: 'networkidle2' });
  
  // Also try clicking through client router
  await page.evaluate(() => {
    // find dashboard link
    const links = document.querySelectorAll('a');
    for (const a of links) {
      if (a.href.includes('dashboard')) {
        a.click();
        return;
      }
    }
  });
  
  await new Promise(r => setTimeout(r, 1000));
  
  await page.evaluate(() => {
    // find sequences link
    const links = document.querySelectorAll('a');
    for (const a of links) {
      if (a.href.includes('sequences')) {
        a.click();
        return;
      }
    }
  });
  
  await new Promise(r => setTimeout(r, 3000));
  
  const content = await page.content();
  if (content.includes('Failed to load sequences')) {
    console.log('ERROR IS VISIBLE ON PAGE!');
  } else {
    console.log('No error visible.');
  }

  await browser.close();
})();
