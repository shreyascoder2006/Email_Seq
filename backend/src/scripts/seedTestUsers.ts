import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import { UserRole } from '../types';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/email_sequencing';

// Define the User schema inline if it doesn't exist in the models directory yet
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  name: { type: String, required: true },
  role: { type: String, enum: Object.values(UserRole), default: UserRole.USER },
  isVerified: { type: Boolean, default: false },
}, { timestamps: true });

// Attempt to use existing model, or compile a new one
const User = mongoose.models.User || mongoose.model('User', userSchema);

const USERS_TO_CREATE = 20;
const DEFAULT_PASSWORD = 'Test@123';

async function seedUsers() {
  console.log(`\n🌱 Seeding ${USERS_TO_CREATE} test users...`);
  console.log(`Connecting to: ${MONGO_URI.replace(/\/\/.*@/, '//***@')}`);

  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Hash the default password once to save time
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, saltRounds);

    const results: Array<{ Email: string; Password: string; Status: string }> = [];

    for (let i = 1; i <= USERS_TO_CREATE; i++) {
      const paddedIndex = i.toString().padStart(2, '0');
      const email = `testuser${paddedIndex}@example.com`;
      const name = `Test User ${paddedIndex}`;

      // Check if user already exists (Idempotent)
      const existingUser = await User.findOne({ email });

      if (existingUser) {
        results.push({
          Email: email,
          Password: DEFAULT_PASSWORD,
          Status: 'Already Exists',
        });
      } else {
        // Create new user
        await User.create({
          email,
          name,
          passwordHash,
          role: UserRole.USER,
          isVerified: true, // Mark as verified/active per requirements
        });

        results.push({
          Email: email,
          Password: DEFAULT_PASSWORD,
          Status: 'Created',
        });
      }
    }

    // Output the results table
    console.log('\n📊 Seeding Results:');
    console.table(results);

  } catch (error) {
    console.error('❌ Error seeding users:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Execute the seeder
seedUsers();
