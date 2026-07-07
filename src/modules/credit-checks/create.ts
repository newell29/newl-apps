import { prisma } from "@/server/db";
import { sendCreditCheckNotification } from "@/modules/credit-checks/notifications";
import { summarizeCreditCheckFields, type CreditCheckFieldRecord } from "@/modules/credit-checks/summary";

type CreateCreditCheckInput = {
  tenantId: string;
  formType: string;
  source?: string;
  pageUrl?: string;
  fields: CreditCheckFieldRecord;
};

export async function createCreditCheckFromAccountSetup(input: CreateCreditCheckInput) {
  const summary = summarizeCreditCheckFields(input.fields);
  const creditCheck = await prisma.creditCheck.create({
    data: {
      tenantId: input.tenantId,
      source: input.source ?? input.formType,
      pageUrl: input.pageUrl,
      fields: input.fields,
      ...summary
    },
    select: {
      id: true,
      createdAt: true,
      company: true,
      legalCompanyName: true,
      operatingName: true,
      primaryContactName: true,
      primaryContactEmail: true,
      accountsPayableEmail: true,
      requestedCreditLimit: true,
      pageUrl: true
    }
  });
  const notification = await sendCreditCheckNotification(creditCheck);

  return {
    creditCheck: {
      id: creditCheck.id,
      createdAt: creditCheck.createdAt
    },
    notification
  };
}
