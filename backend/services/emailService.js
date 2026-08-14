'use strict';

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function sendPasswordResetEmail(toEmail, resetToken) {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

  try {
    await transporter.sendMail({
      from: `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject: 'Reset your PMJ Fleet password',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #d32f2f;">PMJ Fleet Management</h2>
          <p>We received a request to reset your password. Click the button below to set a new one.</p>
          <p>This link expires in 30 minutes.</p>
          <a href="${resetUrl}" style="display: inline-block; background: #1a1a1a; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">Reset Password</a>
          <p style="color: #888; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
        </div>
      `
    });
    return true;
  } catch (err) {
    console.error(`[Email] Failed to send reset email to ${toEmail}: ${err.message}`);
    return false;
  }
}

async function sendAccountActivationEmail(toEmail, activationToken, username) {
  const activateUrl = `${process.env.FRONTEND_URL}/activate-account?token=${activationToken}`;

  try {
    await transporter.sendMail({
      from: `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject: 'Activate your PMJ Fleet account',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #d32f2f;">PMJ Fleet Management</h2>
          <p>Hi ${username || 'there'}, an administrator has set up a PMJ Fleet account for you. Click the button below to set your password and activate it.</p>
          <p>This link expires in 7 days.</p>
          <a href="${activateUrl}" style="display: inline-block; background: #1a1a1a; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">Activate Account</a>
          <p style="color: #888; font-size: 13px;">If you weren't expecting this, you can safely ignore this email.</p>
        </div>
      `
    });
    return true;
  } catch (err) {
    console.error(`[Email] Failed to send activation email to ${toEmail}: ${err.message}`);
    return false;
  }
}

module.exports = { sendPasswordResetEmail, sendAccountActivationEmail };
