import { redirect } from "next/navigation";

/** Books are opened (and added) from their cards on the shelf; there's no separate library page. */
export default function ReaderIndex() {
  redirect("/");
}
