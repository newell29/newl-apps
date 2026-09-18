import type { AuthenticatedContext } from "@/server/tenant-context";
import { prisma } from "@/server/db";
import {
  buildOpportunityWhere,
  CLOSED_STATUSES,
  PAGE_SIZE,
  todayDate,
  type OpportunityFilters
} from "./opportunities";
import { getWebsiteInboundMailboxConfiguration } from "./correspondence";

export async function getWebsiteInboundShell(
  context: AuthenticatedContext,
  filters: OpportunityFilters,
  selected?: string,
  activityPage = 1
) {
  const base = { tenantId: context.tenantId, NOT: { formType: "account_setup" } };
  const where = buildOpportunityWhere(context.tenantId, context.userId, filters);
  const open = { ...base, status: { notIn: CLOSED_STATUSES } };
  const [
    totalCount,
    newCount,
    openCount,
    overdueCount,
    owners,
    detail,
    formTypes,
    mailboxConfiguration,
    unmatchedCorrespondence
  ] =
    await Promise.all([
      prisma.websiteInboundSubmission.count({ where }),
      prisma.websiteInboundSubmission.count({ where: { ...base, status: "NEW" } }),
      prisma.websiteInboundSubmission.count({ where: open }),
      prisma.websiteInboundSubmission.count({
        where: { ...open, followUpOn: { lt: new Date(`${todayDate()}T00:00:00Z`) } }
      }),
      prisma.membership.findMany({
        where: { tenantId: context.tenantId },
        select: { userId: true, user: { select: { name: true, email: true } } },
        orderBy: { user: { name: "asc" } }
      }),
      selected
        ? prisma.websiteInboundSubmission.findFirst({ where: { ...base, id: selected } })
        : null,
      prisma.websiteInboundSubmission.groupBy({
        by: ["formType"],
        where: base,
        _count: { _all: true },
        orderBy: { formType: "asc" }
      }),
      getWebsiteInboundMailboxConfiguration(context.tenantId),
      prisma.websiteInboundEmailMessage.findMany({
        where: {
          tenantId: context.tenantId,
          submissionId: null,
          status: { in: ["RECEIVED", "SENT"] }
        },
        orderBy: [{ messageAt: "desc" }, { id: "desc" }],
        take: 10
      })
    ]);
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  const activityCount = detail
    ? await prisma.websiteInboundActivity.count({
        where: { tenantId: context.tenantId, submissionId: detail.id }
      })
    : 0;
  const activityPages = Math.max(1, Math.ceil(activityCount / PAGE_SIZE));
  const currentActivityPage = Math.min(Math.max(activityPage, 1), activityPages);
  const [submissions, activities, correspondence] = await Promise.all([
    prisma.websiteInboundSubmission.findMany({
      where,
      orderBy: [{ receivedOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        company: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        primaryNeed: true,
        contactChannel: true,
        source: true,
        ownerUserId: true,
        nextAction: true,
        followUpOn: true,
        receivedOn: true,
        lastInboundEmailAt: true,
        lastOutboundEmailAt: true
      }
    }),
    detail
      ? prisma.websiteInboundActivity.findMany({
          where: { tenantId: context.tenantId, submissionId: detail.id },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (currentActivityPage - 1) * PAGE_SIZE,
          take: PAGE_SIZE
        })
      : [],
    detail
      ? prisma.websiteInboundEmailMessage.findMany({
          where: { tenantId: context.tenantId, submissionId: detail.id },
          orderBy: [{ messageAt: "desc" }, { id: "desc" }],
          take: 50
        })
      : []
  ]);
  return {
    submissions,
    detail,
    activities,
    correspondence,
    unmatchedCorrespondence,
    mailboxConfiguration,
    formTypes,
    activityCount,
    activityPage: currentActivityPage,
    activityPages,
    owners: owners.map((owner) => ({
      id: owner.userId,
      label: owner.user.name || owner.user.email,
      email: owner.user.email,
      mailboxAddress: mailboxConfiguration.ownerMailboxes[owner.userId] ?? null
    })),
    metrics: { totalCount, newCount, openCount, overdueCount },
    page,
    pageCount
  };
}
