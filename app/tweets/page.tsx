import { ClipPage, clipMetadata } from "../components/clip-page";

export const metadata = clipMetadata("tweet");

export default function TweetsPage() {
  return <ClipPage kind="tweet" />;
}
