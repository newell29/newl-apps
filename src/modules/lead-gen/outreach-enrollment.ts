import { ContactStatus, JobStatus } from "@prisma/client";

import {
  APOLLO_PUSH_JOB_TYPE,
  createApolloPushJobOutput,
  type ApolloPushJobInput
} from "@/modules/lead-gen/apollo-push-jobs";

export function buildApprovedOutreachEnrollment({
  tenantId,
  contactId,
  assignedRep,
  actorUserId,
  requestedAt
}: {
  tenantId: string;
  contactId: string;
  assignedRep: string | null;
  actorUserId: string;
  requestedAt: Date;
}) {
  const input: ApolloPushJobInput = {
    contactIds: [contactId],
    selectedContacts: 1,
    requestedAt: requestedAt.toISOString()
  };

  return {
    contactUpdate: {
      contactStatus: ContactStatus.APPROVED,
      assignedRep: assignedRep ?? actorUserId
    },
    job: {
      tenantId,
      jobType: APOLLO_PUSH_JOB_TYPE,
      status: JobStatus.QUEUED,
      input,
      output: createApolloPushJobOutput(1, 1)
    }
  };
}
