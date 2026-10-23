import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { authLimiter, sensitiveLimiter } from '../middleware/rateLimits.js';
import * as s from '../validation/schemas.js';
import * as authC from '../controllers/authController.js';
import * as jobC from '../controllers/jobController.js';
import * as resultC from '../controllers/resultController.js';
import * as simC from '../controllers/simulatorController.js';
import * as credC from '../controllers/credentialController.js';
import * as adminC from '../controllers/adminController.js';
import * as sysC from '../controllers/systemController.js';

/** routes → controllers → services → protocol modules → models (Chapter 3 §3.6). */
export const api = Router();

// System
api.get('/health', sysC.health);
api.get('/system/status', requireAuth, sysC.status);
api.get('/protocols', requireAuth, sysC.protocols);
api.get('/literature/table-2-1', requireAuth, sysC.literature);
api.get('/assessment/rubric', requireAuth, resultC.rubric);

// FR1 — authentication
const auth = Router();
auth.post('/register', authLimiter, validate({ body: s.registerBody }), authC.register);
auth.post('/login', authLimiter, validate({ body: s.loginBody }), authC.login);
auth.post('/mfa/verify', sensitiveLimiter, validate({ body: s.mfaVerifyBody }), authC.mfaVerify);
auth.post('/mfa/oob/send', sensitiveLimiter, authC.mfaSendOob);
auth.post('/mfa/webauthn/options', sensitiveLimiter, authC.mfaWebAuthnOptions);
auth.post('/logout', async (req, res, next) => {
  // Logout works with or without a valid session.
  await requireAuth(req, res, () => {}).catch(() => {});
  return authC.logout(req, res, next);
});
auth.get('/me', requireAuth, authC.me);
api.use('/auth', auth);

// FR2/3/5/7/8/9/10 — comparison jobs
const jobs = Router();
jobs.use(requireAuth);
jobs.post('/', validate({ body: s.jobCreateBody }), jobC.create);
jobs.get('/', validate({ query: s.jobListQuery }), jobC.list);
jobs.get('/recent', jobC.recent);
jobs.get('/export', validate({ query: s.jobListQuery.extend(s.exportQuery.shape) }), jobC.exportHistory);
jobs.get('/:id', validate({ params: s.idParam }), jobC.get);
jobs.get('/:id/results', validate({ params: s.idParam }), jobC.results);
jobs.get('/:id/export', validate({ params: s.idParam, query: s.exportQuery }), jobC.exportOne);
jobs.post('/:id/cancel', validate({ params: s.idParam }), jobC.cancel);
api.use('/jobs', jobs);

// FR12 — assessments
api.patch('/results/:id/assessment', requireAuth, validate({ params: s.idParam, body: s.assessmentBody }), resultC.updateAssessment);

// FR4 — single-flow simulators
const sim = Router();
sim.use(requireAuth, sensitiveLimiter);
sim.post('/otp/:protocol/enrol', validate({ params: s.otpProtocolParam, body: s.otpEnrolBody }), simC.otpEnrol);
sim.post('/otp/credentials/:id/verify', validate({ params: s.idParam, body: s.codeBody }), simC.otpVerify);
sim.post('/oob/send', simC.oobSend);
sim.post('/oob/verify', validate({ body: s.oobVerifyBody }), simC.oobVerify);
sim.get('/oob/inbox', simC.oobInbox);
sim.post('/webauthn/register/options', simC.waRegisterOptions);
sim.post('/webauthn/register/verify', validate({ body: s.webauthnResponseBody }), simC.waRegisterVerify);
sim.post('/webauthn/authenticate/options', simC.waAuthOptions);
sim.post('/webauthn/authenticate/verify', validate({ body: s.webauthnResponseBody }), simC.waAuthVerify);
api.use('/simulator', sim);

// Credentials (login factor choice)
const creds = Router();
creds.use(requireAuth);
creds.get('/', credC.list);
creds.patch('/:id', validate({ params: s.idParam, body: s.credentialPatchBody }), credC.update);
creds.delete('/:id', validate({ params: s.idParam }), credC.remove);
api.use('/credentials', creds);

// Administrator: users, protocols, logs (Figure 3.1)
const admin = Router();
admin.use(requireAuth, requireRole('admin'));
admin.get('/users', validate({ query: s.pageQuery }), adminC.listUsers);
admin.patch('/users/:id', validate({ params: s.idParam, body: s.adminUserPatch }), adminC.updateUser);
admin.get('/protocols', adminC.listProtocols);
admin.patch('/protocols/:id', validate({ params: s.idParam, body: s.adminProtocolPatch }), adminC.updateProtocol);
admin.get('/audit-logs', validate({ query: s.auditQuery }), adminC.listAudit);
api.use('/admin', admin);
