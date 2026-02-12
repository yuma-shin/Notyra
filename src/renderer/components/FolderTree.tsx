import React, { useState, useEffect } from 'react'
import {
  FiFolder,
  FiFolderPlus,
  FiChevronRight,
  FiChevronDown,
  FiTrash2,
  FiArrowLeft,
} from 'react-icons/fi'
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useDismiss,
  useInteractions,
  FloatingPortal,
} from '@floating-ui/react'
import type { FolderNode, MarkdownNoteMeta } from '@/shared/types'
import { TagListSection } from './TagListSection'

interface FolderTreeProps {
  node: FolderNode
  selectedFolder: string | null
  onSelectFolder: (relativePath: string) => void
  onCreateFolder?: (parentPath: string) => void
  onDeleteFolder?: (folderPath: string) => void
  showAllNotes?: boolean
  onShowAllNotes?: () => void
  totalNotes?: number
  allNotes?: MarkdownNoteMeta[]
  filteredNotes?: MarkdownNoteMeta[]
  selectedTag?: string | null
  onSelectTag?: (tag: string | null) => void
}

interface FolderItemProps {
  node: FolderNode
  depth: number
  isExpanded: boolean
  isSelected: boolean
  onToggleExpand: () => void
  onSelectFolder: (path: string) => void
  onNavigateToFolder?: (path: string) => void
  onCreateFolder?: (parentPath: string) => void
  onDeleteFolder?: (folderPath: string) => void
}

function FolderItem({
  node,
  depth,
  isExpanded,
  isSelected,
  onToggleExpand,
  onSelectFolder,
  onNavigateToFolder,
  onCreateFolder,
  onDeleteFolder,
}: FolderItemProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 })
  const hasChildren = node.children.length > 0

  const { refs, context } = useFloating({
    open: isMenuOpen,
    onOpenChange: setIsMenuOpen,
    middleware: [offset(4), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })

  const dismiss = useDismiss(context)
  const { getFloatingProps } = useInteractions([dismiss])

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setMenuPosition({ x: e.clientX, y: e.clientY })
    setIsMenuOpen(true)
  }

  const handleCreateFolder = () => {
    if (onCreateFolder) {
      onCreateFolder(node.relativePath)
    }
    setIsMenuOpen(false)
  }

  const handleDeleteFolder = () => {
    if (onDeleteFolder) {
      onDeleteFolder(node.relativePath)
    }
    setIsMenuOpen(false)
  }

  return (
    <div>
      <div
        className={`flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-all duration-200 border-l-4 group ${
          isSelected
            ? 'bg-gradient-to-r from-purple-100 to-indigo-100 dark:from-purple-900/30 dark:to-indigo-900/30 text-purple-700 dark:text-purple-300 font-semibold shadow-sm border-purple-600 dark:border-purple-400'
            : isMenuOpen
              ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-400 dark:border-gray-500'
              : 'hover:bg-gray-100 dark:hover:bg-gray-800/50 text-gray-700 dark:text-gray-300 border-transparent'
        }`}
        style={{ paddingLeft: `${depth * 20 + 16}px` }}
      >
        <div className="w-5 flex-shrink-0 flex items-center justify-center">
          {hasChildren && (
            <button
              className="text-gray-500 hover:text-purple-600 dark:text-gray-400 dark:hover:text-purple-400 transition-colors"
              onClick={e => {
                e.stopPropagation()
                onToggleExpand()
              }}
              type="button"
            >
              {isExpanded ? (
                <FiChevronDown size={14} />
              ) : (
                <FiChevronRight size={14} />
              )}
            </button>
          )}
        </div>
        <button
          className="flex items-center gap-2 flex-1 text-left"
          onClick={() => onSelectFolder(node.relativePath)}
          onContextMenu={handleContextMenu}
          onDoubleClick={() =>
            hasChildren && onNavigateToFolder?.(node.relativePath)
          }
          type="button"
        >
          <span className="text-sm flex-1">{node.name}</span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              isSelected
                ? 'bg-purple-600/20 dark:bg-purple-400/20 text-purple-700 dark:text-purple-300'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
            }`}
          >
            {node.notes?.length || 0}
          </span>
        </button>
      </div>

      {isMenuOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{
              position: 'fixed',
              top: menuPosition.y,
              left: menuPosition.x,
              zIndex: 9999,
            }}
            {...getFloatingProps()}
            className="bg-white dark:bg-gray-800 shadow-lg rounded-lg py-1 min-w-[180px] border border-gray-200 dark:border-gray-700"
          >
            <div className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 font-medium">
              {node.name}
            </div>
            {onCreateFolder && (
              <button
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-gray-700 dark:text-gray-300"
                onClick={handleCreateFolder}
                type="button"
              >
                <FiFolderPlus size={14} />
                <span>サブフォルダを作成</span>
              </button>
            )}
            {onDeleteFolder && node.relativePath !== '' && (
              <button
                className="w-full px-4 py-2 text-left text-sm hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2 text-red-600 dark:text-red-400"
                onClick={handleDeleteFolder}
                type="button"
              >
                <FiTrash2 size={14} />
                <span>このフォルダを削除</span>
              </button>
            )}
          </div>
        </FloatingPortal>
      )}
    </div>
  )
}

export function FolderTree({
  node,
  selectedFolder,
  onSelectFolder,
  onCreateFolder,
  onDeleteFolder,
  showAllNotes,
  onShowAllNotes,
  totalNotes = 0,
  allNotes = [],
  filteredNotes = [],
  selectedTag = null,
  onSelectTag,
}: FolderTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']))
  const [currentPath, setCurrentPath] = useState<string>('')
  const [displayPath, setDisplayPath] = useState<string>('')
  const [prevPath, setPrevPath] = useState<string>('')
  const [animationDirection, setAnimationDirection] = useState<
    'forward' | 'backward' | null
  >(null)

  useEffect(() => {
    setDisplayPath(currentPath)
  }, [])

  useEffect(() => {
    if (showAllNotes) {
      setCurrentPath('')
      setDisplayPath('')
      setPrevPath('')
      setAnimationDirection(null)
    }
  }, [showAllNotes])

  // selectedFolderが変更された時に、そのフォルダまでのパスを展開
  useEffect(() => {
    if (selectedFolder !== null && selectedFolder !== '') {
      // selectedFolderまでのすべての親フォルダを展開（既存の展開状態は維持）
      setExpanded(prev => {
        const next = new Set(prev)
        next.add('') // ルートは常に展開

        const pathParts = selectedFolder.split(/[\\/]/).filter(Boolean)
        let accumulatedPath = ''
        for (const part of pathParts) {
          accumulatedPath = accumulatedPath
            ? `${accumulatedPath}/${part}`
            : part
          next.add(accumulatedPath)
        }

        return next
      })
    }
  }, [selectedFolder])

  const toggleExpand = (path: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const getNodeByPath = (path: string): FolderNode => {
    if (path === '') return node

    const pathParts = path.split(/[\\/]/).filter(Boolean)
    let current = node

    for (const part of pathParts) {
      const found = current.children.find(child => child.name === part)
      if (!found) return node
      current = found
    }

    return current
  }

  const getBreadcrumbs = (): Array<{
    name: string
    path: string
    isEllipsis?: boolean
  }> => {
    if (currentPath === '') {
      return [{ name: node.name, path: '' }]
    }

    const pathParts = currentPath.split(/[\\/]/).filter(Boolean)
    const fullBreadcrumbs: Array<{ name: string; path: string }> = [
      { name: node.name, path: '' },
    ]

    let accumulatedPath = ''
    for (const part of pathParts) {
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part
      fullBreadcrumbs.push({ name: part, path: accumulatedPath })
    }

    if (fullBreadcrumbs.length > 4) {
      const root = fullBreadcrumbs[0]
      const lastTwo = fullBreadcrumbs.slice(-2)
      return [
        root,
        {
          name: '...',
          path: fullBreadcrumbs[fullBreadcrumbs.length - 3].path,
          isEllipsis: true,
        },
        ...lastTwo,
      ]
    }

    return fullBreadcrumbs
  }

  const handleNavigateToFolder = (path: string) => {
    setPrevPath(displayPath)
    setCurrentPath(path)
    setAnimationDirection('forward')

    // ナビゲート先のパスとその親パスを展開状態に追加（既存の展開状態を維持）
    setExpanded(prev => {
      const next = new Set(prev)
      const pathParts = path.split(/[\\/]/).filter(Boolean)
      let accumulatedPath = ''
      next.add('') // ルートは常に展開
      for (const part of pathParts) {
        accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part
        next.add(accumulatedPath)
      }
      return next
    })

    setTimeout(() => {
      setDisplayPath(path)
      setAnimationDirection(null)
      setPrevPath('')
    }, 300)
  }

  const handleNavigateUp = () => {
    if (currentPath === '') return

    const pathParts = currentPath.split(/[\\/]/).filter(Boolean)
    pathParts.pop()
    const newPath = pathParts.join('/')

    setPrevPath(displayPath)
    setCurrentPath(newPath)
    setAnimationDirection('backward')

    // 上へ戻る際も既存の展開状態を維持し、新しいパスまでの親パスを追加
    setExpanded(prev => {
      const next = new Set(prev)
      const pathParts = newPath.split(/[\\/]/).filter(Boolean)
      let accumulatedPath = ''
      next.add('') // ルートは常に展開
      for (const part of pathParts) {
        accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part
        next.add(accumulatedPath)
      }
      return next
    })

    setTimeout(() => {
      setDisplayPath(newPath)
      setAnimationDirection(null)
      setPrevPath('')
    }, 300)
  }

  const handleBreadcrumbClick = (path: string) => {
    if (path === currentPath) return

    const currentDepth = currentPath.split(/[\\/]/).filter(Boolean).length
    const targetDepth =
      path === '' ? 0 : path.split(/[\\/]/).filter(Boolean).length

    setPrevPath(displayPath)
    setCurrentPath(path)
    setAnimationDirection(targetDepth > currentDepth ? 'forward' : 'backward')

    // パンくずリストクリック時も既存の展開状態を維持し、新しいパスまでの親パスを追加
    setExpanded(prev => {
      const next = new Set(prev)
      const pathParts = path === '' ? [] : path.split(/[\\/]/).filter(Boolean)
      let accumulatedPath = ''
      next.add('') // ルートは常に展開
      for (const part of pathParts) {
        accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part
        next.add(accumulatedPath)
      }
      return next
    })

    setTimeout(() => {
      setDisplayPath(path)
      setAnimationDirection(null)
      setPrevPath('')
    }, 300)
  }

  const renderNode = (n: FolderNode, depth: number = 0): React.ReactNode => {
    const isExpanded = expanded.has(n.relativePath)
    // パスを正規化して比較（バックスラッシュをスラッシュに統一）
    const normalizedNodePath = n.relativePath.replace(/\\/g, '/')
    const normalizedSelectedFolder = selectedFolder?.replace(/\\/g, '/') ?? null
    const isSelected =
      !showAllNotes && normalizedSelectedFolder === normalizedNodePath

    return (
      <div key={n.relativePath}>
        <FolderItem
          depth={depth}
          isExpanded={isExpanded}
          isSelected={isSelected}
          node={n}
          onCreateFolder={onCreateFolder}
          onDeleteFolder={onDeleteFolder}
          onNavigateToFolder={handleNavigateToFolder}
          onSelectFolder={onSelectFolder}
          onToggleExpand={() => toggleExpand(n.relativePath)}
        />
        {isExpanded && n.children.map(child => renderNode(child, depth + 1))}
      </div>
    )
  }

  const currentNode = getNodeByPath(currentPath)
  const prevNode = getNodeByPath(prevPath)
  const displayNode = getNodeByPath(displayPath)
  const breadcrumbs = getBreadcrumbs()

  return (
    <div className="w-64 border-r border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-950 flex flex-col h-full">
      <div
        className="border-b border-gray-200 dark:border-gray-700 flex-shrink-0"
        style={{
          background:
            'linear-gradient(to bottom, rgba(102, 126, 234, 0.05), transparent)',
        }}
      >
        <div className="h-14 flex items-center justify-between px-4">
          <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <FiFolder
              className="text-purple-600 dark:text-purple-400"
              size={16}
            />
            フォルダ
          </h2>
          {onCreateFolder && (
            <button
              className="p-2 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-lg transition-all duration-200 text-purple-600 dark:text-purple-400 shadow-sm hover:shadow"
              onClick={() => onCreateFolder(currentPath)}
              title="フォルダ作成"
              type="button"
            >
              <FiFolderPlus size={16} />
            </button>
          )}
        </div>

        <div className="px-4 pb-3 flex items-center gap-2">
          {currentPath !== '' && (
            <button
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors flex-shrink-0"
              onClick={handleNavigateUp}
              title="上へ戻る"
              type="button"
            >
              <FiArrowLeft size={14} />
            </button>
          )}
          <div className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 min-w-0 flex-1">
            {breadcrumbs.map((crumb, index) => (
              <React.Fragment key={`${crumb.path}-${index}`}>
                {index > 0 && (
                  <span className="text-gray-400 dark:text-gray-600 flex-shrink-0">
                    /
                  </span>
                )}
                <button
                  className={`transition-colors flex-shrink-0 ${
                    crumb.isEllipsis
                      ? 'hover:text-purple-600 dark:hover:text-purple-400'
                      : index === breadcrumbs.length - 1
                        ? 'font-semibold text-purple-600 dark:text-purple-400'
                        : 'hover:text-purple-600 dark:hover:text-purple-400 hover:underline'
                  }`}
                  onClick={() => handleBreadcrumbClick(crumb.path)}
                  title={crumb.isEllipsis ? '中間の階層' : undefined}
                  type="button"
                >
                  <span
                    className={
                      crumb.isEllipsis
                        ? ''
                        : 'truncate max-w-[80px] inline-block'
                    }
                  >
                    {crumb.name}
                  </span>
                </button>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      <div className="py-2 overflow-y-auto flex-1 min-h-0 relative">
        {onShowAllNotes && (
          <button
            className={`flex items-center gap-2 px-3 py-2.5 mb-2 cursor-pointer transition-all duration-200 border-l-4 ${
              showAllNotes
                ? 'bg-gradient-to-r from-purple-100 to-indigo-100 dark:from-purple-900/30 dark:to-indigo-900/30 text-purple-700 dark:text-purple-300 font-semibold shadow-sm border-purple-600 dark:border-purple-400'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800/50 text-gray-700 dark:text-gray-300 border-transparent'
            }`}
            onClick={onShowAllNotes}
            title="すべてのノートを表示"
            type="button"
          >
            <span className="text-sm flex-1">すべてのノート</span>
            {totalNotes > 0 && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  showAllNotes
                    ? 'bg-purple-600/20 dark:bg-purple-400/20 text-purple-700 dark:text-purple-300'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                }`}
              >
                {totalNotes}
              </span>
            )}
          </button>
        )}
        {/* 古いコンテンツ（アニメーション中のみ表示） */}
        {animationDirection && prevPath !== '' && (
          <div
            className={`absolute inset-0 transition-all duration-300 ease-out ${
              animationDirection === 'forward'
                ? '-translate-x-full' // 深掘り時: 左に退出
                : 'translate-x-full' // 戻る時: 右に退出
            }`}
          >
            {renderNode(prevNode)}
          </div>
        )}

        {/* 新しいコンテンツ */}
        <div
          className="transition-all duration-300 ease-out"
          key={animationDirection ? currentPath : displayPath}
          style={{
            transform:
              animationDirection === 'forward'
                ? 'translateX(0)'
                : animationDirection === 'backward'
                  ? 'translateX(0)'
                  : 'translateX(0)',
            animation:
              animationDirection === 'forward'
                ? 'slideInFromRight 300ms ease-out'
                : animationDirection === 'backward'
                  ? 'slideInFromLeft 300ms ease-out'
                  : 'none',
          }}
        >
          {animationDirection
            ? renderNode(currentNode)
            : renderNode(displayNode)}
        </div>

        <style>{`
        @keyframes slideInFromRight {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        
        @keyframes slideInFromLeft {
          from {
            transform: translateX(-100%);
          }
          to {
            transform: translateX(0);
          }
        }
      `}</style>

        <TagListSection
          allNotes={allNotes}
          filteredNotes={filteredNotes}
          onSelectTag={onSelectTag}
          selectedTag={selectedTag}
          showAllNotes={showAllNotes || false}
        />
      </div>
    </div>
  )
}
