/** Shared types between the campaign server actions and the client forms. */

export interface CampaignActionResult {
  ok: boolean;
  message: string;
  campaignId?: string;
}
