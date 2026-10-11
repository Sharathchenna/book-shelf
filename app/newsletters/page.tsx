import { ClipPage, clipMetadata } from "../components/clip-page";

export const metadata = clipMetadata("newsletter");

export default function NewslettersPage({ searchParams }: PageProps<"/newsletters">) {
  return <ClipPage kind="newsletter" searchParams={searchParams} />;
}
