import { ClipPage, clipMetadata } from "../components/clip-page";

export const metadata = clipMetadata("paper");

export default function PapersPage() {
  return <ClipPage kind="paper" />;
}
