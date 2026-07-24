export type ApolloMatchReviewActionState = {
  status: "idle" | "success" | "error";
  message: string | null;
  completedAt: string | null;
};

export const EMPTY_APOLLO_MATCH_REVIEW_ACTION_STATE: ApolloMatchReviewActionState = {
  status: "idle",
  message: null,
  completedAt: null
};
