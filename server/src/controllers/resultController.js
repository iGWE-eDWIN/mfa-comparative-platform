import { Result, ComparisonJob } from '../models/index.js';
import { applyAssessmentEdit, RUBRIC } from '../services/assessmentService.js';
import { audit } from '../services/auditService.js';
import { HttpError } from '../middleware/errors.js';

async function owned(req) {
  const r = await Result.findById(req.params.id);
  if (!r) throw new HttpError(404, 'Result not found', 'NOT_FOUND');
  const job = await ComparisonJob.exists({ _id: r.jobId, userId: req.user.id });
  if (!job) throw new HttpError(404, 'Result not found', 'NOT_FOUND');
  return r;
}

/** FR12: record usability and integration observations on a result. */
export async function updateAssessment(req, res) {
  const r = await owned(req);
  if (req.body.integration) r.integrationAssessment = applyAssessmentEdit(r.integrationAssessment, req.body.integration, req.user.id);
  if (req.body.usability) r.usabilityAssessment = applyAssessmentEdit(r.usabilityAssessment, req.body.usability, req.user.id);
  r.markModified('integrationAssessment');
  r.markModified('usabilityAssessment');
  await r.save();
  await audit(req.user.id, 'result.assessment_updated', { resultId: String(r._id), protocol: r.protocolName });
  res.json({ integrationAssessment: r.integrationAssessment, usabilityAssessment: r.usabilityAssessment });
}

export function rubric(_req, res) {
  res.json({ rubric: RUBRIC });
}
