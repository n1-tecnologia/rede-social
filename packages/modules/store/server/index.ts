/**
 * `@rede-social/module-store/server` — everything the API tier may touch. The app imports THIS, never
 * a file path inside the package (the `exports` map has no `./server/*`).
 */
export { storeRoutes } from './routes';
export {
  createProduct,
  getCommunityAccess,
  getProduct,
  grantAccess,
  listBuyers,
  listCommunityAccess,
  listProducts,
  lockPreview,
  purchaseProduct,
  revokeAccess,
  setProductStatus,
  updateProduct,
} from './service';
