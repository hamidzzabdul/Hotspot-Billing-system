import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { pathToFileURL } from 'node:url';
import { configuration } from './config.js';
import { User, Settings, initializeModels } from './models.js';

export async function seed({ email, password, name = 'Network administrator' } = {}) {
  if (!email || !password || password.length < 12)
    throw new Error(
      'Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters). No default production credentials are created.',
    );
  await initializeModels();
  if (!(await User.exists({ email: email.toLowerCase() })))
    await User.create({
      name,
      email: email.toLowerCase(),
      password: await bcrypt.hash(password, 12),
      role: 'admin',
    });
  await Settings.updateOne(
    { key: 'main' },
    { $setOnInsert: { businessName: 'Wifex' } },
    { upsert: true },
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = configuration();
    await mongoose.connect(config.mongoUri);
    await seed({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
      name: process.env.ADMIN_NAME,
    });
    console.log(
      'Administrator is ready. Existing accounts were preserved. Create your plans in the operator dashboard.',
    );
  } finally {
    await mongoose.disconnect();
  }
}
