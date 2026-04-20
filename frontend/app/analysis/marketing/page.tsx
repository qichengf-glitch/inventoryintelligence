import { redirect } from "next/navigation";

/** Old path; bookmarks still work. */
export default function LegacyMarketingRedirect() {
  redirect("/marketing");
}
