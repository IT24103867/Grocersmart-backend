const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');

dotenv.config();

const seedAdmin = async () => {
    try {
        const DB = process.env.DATABASE;
        if (!DB) throw new Error('DATABASE URI not found in .env');

        await mongoose.connect(DB);
        console.log('DB connection successful for seeding...');

        const adminExists = await User.findOne({ role: 'ADMIN' });
        if (adminExists) {
            console.log('Admin user already exists!');
            process.exit();
        }

        const admin = await User.create({
            fullName: 'Super Admin',
            username: 'admin',
            email: 'admin@ambal.com',
            password: 'admin1234', // Change this immediately!
            role: 'ADMIN'
        });

        console.log('Admin user created successfully:');
        console.log(`Username: ${admin.username}`);
        console.log('Password: admin1234');

        
        process.exit();
    } catch (err) {
        console.error('Error seeding admin:', err.message);
        process.exit(1);
    }
};

seedAdmin();
