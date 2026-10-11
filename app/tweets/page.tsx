import { ClipPage, clipMetadata } from "../components/clip-page";

export const metadata = clipMetadata("tweet");

export default function TweetsPage({ searchParams }: PageProps<"/tweets">) {
  return <ClipPage kind="tweet" searchParams={searchParams} />;
}
