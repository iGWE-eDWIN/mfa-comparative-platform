import mongoose from 'mongoose';

export const ROLES = ['user', 'admin'];
export const USER_STATUSES = ['active', 'suspended'];

/** users collection (Chapter 3 §3.9.1). */
const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 32 },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'user' },
    status: { type: String, enum: USER_STATUSES, default: 'active' },
  },
  { timestamps: true, collection: 'users' },
);

userSchema.methods.toSafeJSON = function toSafeJSON() {
  const { _id, username, email, role, status, createdAt, updatedAt } = this;
  return { id: String(_id), username, email, role, status, createdAt, updatedAt };
};

export const User = mongoose.models.User ?? mongoose.model('User', userSchema);
