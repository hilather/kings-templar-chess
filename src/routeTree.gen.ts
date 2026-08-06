/* eslint-disable */
// @ts-nocheck
import { Route as rootRouteImport } from './routes/__root'
import { Route as IndexRouteImport } from './routes/index'
import { Route as ApiRtcRouteImport } from './routes/api/rtc'

const IndexRoute = IndexRouteImport.update({
  id: '/',
  path: '/',
  getParentRoute: () => rootRouteImport,
} as any)
const ApiRtcRoute = ApiRtcRouteImport.update({
  id: '/api/rtc',
  path: '/api/rtc',
  getParentRoute: () => rootRouteImport,
} as any)

export interface FileRoutesByFullPath {
  '/': typeof IndexRoute
  '/api/rtc': typeof ApiRtcRoute
}
export interface FileRoutesByTo {
  '/': typeof IndexRoute
  '/api/rtc': typeof ApiRtcRoute
}
export interface FileRoutesById {
  __root__: typeof rootRouteImport
  '/': typeof IndexRoute
  '/api/rtc': typeof ApiRtcRoute
}
export interface FileRouteTypes {
  fileRoutesByFullPath: FileRoutesByFullPath
  fullPaths: '/' | '/api/rtc'
  fileRoutesByTo: FileRoutesByTo
  to: '/' | '/api/rtc'
  id: '__root__' | '/' | '/api/rtc'
  fileRoutesById: FileRoutesById
}
export interface RootRouteChildren {
  IndexRoute: typeof IndexRoute
  ApiRtcRoute: typeof ApiRtcRoute
}

declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/': {
      id: '/'
      path: '/'
      fullPath: '/'
      preLoaderRoute: typeof IndexRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/api/rtc': {
      id: '/api/rtc'
      path: '/api/rtc'
      fullPath: '/api/rtc'
      preLoaderRoute: typeof ApiRtcRouteImport
      parentRoute: typeof rootRouteImport
    }
  }
}

const rootRouteChildren: RootRouteChildren = {
  IndexRoute: IndexRoute,
  ApiRtcRoute: ApiRtcRoute,
}
export const routeTree = rootRouteImport
  ._addFileChildren(rootRouteChildren)
  ._addFileTypes<FileRouteTypes>()
