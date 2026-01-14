const mongoose = require('mongoose');

const clinicSchema = new mongoose.Schema({
    name: { type: String, required: true },
    businessPhoneNumber: { type: String, required: true, unique: true },
    logoUrl: { type: String }, // Optional
    phoneNumberId: { type: String, required: true, unique: true },
    whatsappToken: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Clinic', clinicSchema);
