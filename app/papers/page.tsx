import { ClipPage, clipMetadata } from "../components/clip-page";

export const metadata = clipMetadata("paper");

export default function PapersPage({ searchParams }: PageProps<"/papers">) {
  return <ClipPage kind="paper" searchParams={searchParams} />;
}
