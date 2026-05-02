const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    publicId: {
      type: String,
      unique: true,
      sparse: true,
    },
    fullName: {
      type: String,
      required: [true, "Please provide your full name"],
    },
    username: {
      type: String,
      required: [true, "Please provide a username"],
      unique: true,
    },
    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: [true, "Please provide a password"],
      minlength: 8,
      select: false,
    },
    phone: {
      type: String,
    },
    role: {
      type: String,
      enum: ["ADMIN", "MANAGER", "CASHIER", "STAFF"],
      default: "CASHIER",
    },
    // Feature-level permissions array
    permissions: {
      type: [String],
      enum: [
        "POS_ACCESS",
        "VOID_SALE",
        "VIEW_REPORTS",
        "MANAGE_INVENTORY",
        "MANAGE_USERS",
        "MANAGE_CREDIT",
        "MANAGE_SUPPLIERS",
        "MANAGE_CHEQUES",
      ],
      default: [],
    },
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE"],
      default: "ACTIVE",
    },
    lastLogin: {
      type: Date,
    },
    activityLogs: [
      {
        action: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
        ipAddress: { type: String },
      },
    ],
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

// Auto-generate publicId and hash password before saving
userSchema.pre("save", async function () {
  if (!this.publicId) {
    this.publicId = "USR-" + Math.random().toString(36).substr(2, 8).toUpperCase();
  }
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 12);
});

// Instance method to check password
userSchema.methods.correctPassword = async function (candidatePassword, userPassword) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

const User = mongoose.model("User", userSchema);
module.exports = User;
