import { User, Protocol, AuditLog, ComparisonJob } from '../models/index.js';
import { validateParams } from '../protocols/ProtocolManager.js';
import { audit } from '../services/auditService.js';
import { HttpError } from '../middleware/errors.js';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function listUsers(req, res) {
  const { page, limit, q } = req.validQuery;
  const filter = q
    ? {
        $or: [
          { username: new RegExp(escapeRegex(q), 'i') },
          { email: new RegExp(escapeRegex(q), 'i') },
        ],
      }
    : {};
  const [items, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(filter),
  ]);
  const counts = await ComparisonJob.aggregate([
    { $match: { userId: { $in: items.map((u) => u._id) } } },
    { $group: { _id: '$userId', n: { $sum: 1 } } },
  ]);
  res.json({
    items: items.map((u) => ({
      ...u.toSafeJSON(),
      jobCount: counts.find((c) => String(c._id) === String(u._id))?.n ?? 0,
    })),
    total,
    page,
    limit,
  });
}

export async function updateUser(req, res) {
  if (req.params.id === req.user.id)
    throw new HttpError(
      400,
      'Administrators cannot change their own role or status',
      'SELF_UPDATE',
    );
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { $set: req.body },
    { new: true, runValidators: true },
  );
  if (!user) throw new HttpError(404, 'User not found', 'NOT_FOUND');
  await audit(req.user.id, 'admin.user_updated', {
    targetUserId: req.params.id,
    changes: req.body,
  });
  res.json({ user: user.toSafeJSON() });
}

export async function listProtocols(_req, res) {
  res.json({ items: await Protocol.find().sort({ name: 1 }).lean() });
}

export async function updateProtocol(req, res) {
  const protocol = await Protocol.findById(req.params.id);
  if (!protocol) throw new HttpError(404, 'Protocol not found', 'NOT_FOUND');
  if (req.body.status) protocol.status = req.body.status;
  if (req.body.parameters) {
    const current = Object.fromEntries(
      protocol.defaultConfig.parameters.map((p) => [p.name, p.value]),
    );
    const validated = validateParams(protocol.name, { ...current, ...req.body.parameters });
    protocol.defaultConfig.parameters = Object.entries(validated).map(([name, value]) => ({
      name,
      value,
      type: typeof value,
    }));
  }
  await protocol.save();
  await audit(req.user.id, 'admin.protocol_updated', {
    protocol: protocol.name,
    status: req.body.status,
    parameters: req.body.parameters ? Object.keys(req.body.parameters) : undefined,
  });
  res.json({ protocol });
}

export async function listAudit(req, res) {
  const { action, userId, from, to, page, limit } = req.validQuery;
  const filter = {};
  if (action) filter.action = new RegExp(`^${escapeRegex(action)}`);
  if (userId) filter.userId = userId;
  if (from || to) filter.timestamp = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
  const [items, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('userId', 'username')
      .lean(),
    AuditLog.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
}
