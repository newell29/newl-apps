import { Prisma } from "@prisma/client";

export async function persistOutreachPlanWithSteps({
  transaction,
  plan,
  steps
}: {
  transaction: Prisma.TransactionClient;
  plan: Prisma.OutreachPlanUncheckedCreateInput;
  steps: Array<Omit<Prisma.OutreachSequenceStepCreateManyInput, "outreachPlanId">>;
}) {
  const createdPlan = await transaction.outreachPlan.create({
    data: plan
  });

  await transaction.outreachSequenceStep.createMany({
    data: steps.map((step) => ({
      ...step,
      outreachPlanId: createdPlan.id
    }))
  });

  return createdPlan;
}
