import { ClipPage, clipMetadata } from "../components/clip-page";

export const metadata = clipMetadata("article");

export default function ArticlesPage() {
  return <ClipPage kind="article" />;
}
