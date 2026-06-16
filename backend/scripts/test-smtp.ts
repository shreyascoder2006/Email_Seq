import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from backend/.env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function runSmtpTest() {
  console.log('--- GMAIL SMTP VERIFICATION TEST ---');

  // Read credentials
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true'; // true for 465, false for other ports
  const user = process.env.SMTP_USER;
  
  // Defensive coding: automatically remove spaces
  const rawPass = process.env.SMTP_PASS || '';
  const pass = rawPass.replace(/\s+/g, '');
  
  const fromEmail = process.env.EMAIL_FROM || user;

  if (!user || !pass) {
    console.error('❌ Missing SMTP_USER or SMTP_PASS in environment variables.');
    process.exit(1);
  }

  // Mask password for safe logging
  const maskedPass = pass.length > 4 
    ? `${pass.substring(0, 2)}...${pass.substring(pass.length - 2)}` 
    : '***';

  console.log('\n[1] Configuration loaded:');
  console.log(`    Host: ${host}`);
  console.log(`    Port: ${port}`);
  console.log(`    Secure: ${secure}`);
  console.log(`    User: ${user}`);
  console.log(`    Pass: ${maskedPass} (Length: ${pass.length})`);
  console.log(`    From: ${fromEmail}`);

  console.log('\n[2] Initializing Nodemailer transporter...');
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
    // Detailed debug logs for troubleshooting
    logger: true,
    debug: true,
    connectionTimeout: 10000, // 10 seconds
  });

  try {
    console.log('\n[3] Verifying SMTP connection...');
    const verifySuccess = await transporter.verify();
    console.log('✅ SMTP connection verified successfully!');

    console.log('\n[4] Sending test email...');
    const info = await transporter.sendMail({
      from: `"SMTP Tester" <${fromEmail}>`,
      to: user, // send to self for testing
      subject: 'Test Email - SMTP Configuration Verified',
      text: 'If you are reading this, your Gmail SMTP configuration is working perfectly.',
      html: '<b>If you are reading this, your Gmail SMTP configuration is working perfectly.</b>'
    });

    console.log('✅ Test email sent successfully!');
    console.log(`    Message-ID: ${info.messageId}`);
    
  } catch (error: any) {
    console.error('\n❌ SMTP Error Encountered:');
    console.error(error.message || error);
    
    // Provide hints based on common errors
    if (error.message && error.message.includes('Username and Password not accepted')) {
      console.log('\n💡 HINT (535-5.7.8 Error):');
      console.log('1. Ensure you are using an App Password, NOT your main Google account password.');
      console.log('2. Ensure 2-Step Verification is enabled on your Google account.');
      console.log('3. Ensure there are no trailing spaces in the password.');
      console.log('4. Ensure Less Secure Apps is NOT what you are trying to use (it is deprecated).');
    }
    
    process.exit(1);
  } finally {
    transporter.close();
    console.log('\n--- TEST COMPLETE ---');
    process.exit(0);
  }
}

runSmtpTest();
