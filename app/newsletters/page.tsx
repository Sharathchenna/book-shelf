import { ClipPage, clipMetadata } from "../components/clip-page";

export const metadata = clipMetadata("newsletter");

export default function NewslettersPage() {
  return <ClipPage kind="newsletter" />;
}
