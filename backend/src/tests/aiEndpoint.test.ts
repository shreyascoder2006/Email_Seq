import '../config/env';
import logger from '../config/logger';

async function runTests() {
  logger.info('Starting AI HTTP Endpoint tests...');
  
  const baseUrl = `http://localhost:${process.env.PORT || 5000}/api`;
  let passed = true;

  try {
    // 0. Wait for server to be up (we assume it's running)
    const healthRes = await fetch(`${baseUrl}/health/ping`);
    if (!healthRes.ok) throw new Error('Server not running');
    logger.info('✅ Server health check passed');

    // 1. Unauthenticated test
    logger.info('A. Testing unauthenticated endpoint...');
    const unauthRes = await fetch(`${baseUrl}/ai/generate-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objective: 'Test', length: 'short', offering: 'Test', audience: 'Test' })
    });

    if (unauthRes.status === 401) {
      logger.info('✅ 401 Unauthorized returned as expected');
    } else {
      logger.error(`❌ Expected 401 but got ${unauthRes.status}`);
      passed = false;
    }

    // 2. Get auth token
    logger.info('B. Getting auth token...');
    const authRes = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com' })
    });
    const authData: any = await authRes.json();
    const token = authData.data.token;
    if (!token) throw new Error('Failed to get auth token');
    logger.info('✅ Auth token acquired');

    // 3. Invalid DTO test
    logger.info('C. Testing invalid request DTO...');
    const invalidRes = await fetch(`${baseUrl}/ai/generate-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ objective: '', length: 'gigantic' })
    });

    if (invalidRes.status === 400) {
      logger.info('✅ 400 Bad Request returned as expected for invalid DTO');
    } else {
      logger.error(`❌ Expected 400 but got ${invalidRes.status}`);
      passed = false;
    }

    // 4. Authenticated generation test
    logger.info('D. Testing authenticated REAL Gemini generation (may take a few seconds)...');
    const validRes = await fetch(`${baseUrl}/ai/generate-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        objective: "Book a product demo",
        length: "short",
        offering: "An email sequencing platform that helps sales teams automate personalized outreach",
        audience: "Sales managers at B2B SaaS companies",
        painPoint: "Manually following up with leads takes too much time",
        cta: "Ask if they are open to a 15-minute demo",
        guidance: "Professional, conversational and not overly salesy"
      })
    });

    const body: any = await validRes.json();

    if (validRes.status === 200 && body.success === true && body.data && body.data.subject && body.data.bodyHtml) {
      logger.info('✅ 200 OK returned with correct response shape');
      logger.info('\n==================================================');
      logger.info(`SUBJECT: \n${body.data.subject}`);
      logger.info(`\nBODY: \n${body.data.bodyHtml}`);
      logger.info('==================================================\n');
    } else {
      logger.error(`❌ Generation test failed. Status: ${validRes.status}, Body: ${JSON.stringify(body)}`);
      passed = false;
    }

  } catch (err: any) {
    logger.error('❌ Test execution failed', { error: err.message });
    passed = false;
  }

  if (passed) {
    logger.info('🎉 All AI Endpoint tests PASSED');
    process.exit(0);
  } else {
    logger.error('💥 AI Endpoint tests FAILED');
    process.exit(1);
  }
}

runTests();
