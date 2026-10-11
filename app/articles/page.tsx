import { ClipPage, clipMetadata } from "../components/clip-page";

export const metadata = clipMetadata("article");

export default function ArticlesPage({ searchParams }: PageProps<"/articles">) {
  return <ClipPage kind="article" searchParams={searchParams} />;
}
