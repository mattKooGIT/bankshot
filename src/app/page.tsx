import { redirect } from "next/navigation";

// The market is the home page.
export default function Home() {
  redirect("/market");
}
