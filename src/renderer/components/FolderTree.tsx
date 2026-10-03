import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LuFolder,
  LuFolderPlus,
  LuChevronRight,
  LuChevronDown,
  LuTrash2,
  LuArrowLeft,
} from 'react-icons/lu'
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
import { SimpleTooltip } from './ui/tooltip'
import { Button } from './ui/button'
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
  /** 指定時はpxで幅を固定する（未指定時は既存の固定幅クラスを使用） */
  width?: number
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
  const { t } = useTranslation()
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
        className={`sidebar-item flex items-center gap-2 mx-2 px-2 py-2 cursor-pointer text-foreground ${
          isSelected ? 'font-semibold' : ''
        }`}
        data-active={isSelected || isMenuOpen}
        onClick={() => onSelectFolder(node.relativePath)}
        onContextMenu={handleContextMenu}
        onDoubleClick={() =>
          hasChildren && onNavigateToFolder?.(node.relativePath)
        }
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            onSelectFolder(node.relativePath)
          }
        }}
        role="treeitem"
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        tabIndex={0}
      >
        <div className="w-5 flex-shrink-0 flex items-center justify-center">
          {hasChildren && (
            <button
              className="text-muted-foreground hover:text-foreground transition-colors"
              onClick={e => {
                e.stopPropagation()
                onToggleExpand()
              }}
              type="button"
            >
              {isExpanded ? (
                <LuChevronDown size={14} />
              ) : (
                <LuChevronRight size={14} />
              )}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm flex-1 truncate">{node.name}</span>
          <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 bg-muted text-muted-foreground">
            {node.notes?.length || 0}
          </span>
        </div>
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
            className="bg-popover text-popover-foreground shadow-[var(--elevation-md)] rounded-lg py-1 min-w-[180px] border border-border"
          >
            <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border font-medium">
              {node.name}
            </div>
            {onCreateFolder && (
              <button
                className="w-full px-4 py-2 text-left text-sm hover:bg-accent flex items-center gap-2 text-foreground"
                onClick={handleCreateFolder}
                type="button"
              >
                <LuFolderPlus size={14} />
                <span>{t('folderTree.createSubfolder')}</span>
              </button>
            )}
            {onDeleteFolder && node.relativePath !== '' && (
              <button
                className="w-full px-4 py-2 text-left text-sm hover:bg-destructive/10 flex items-center gap-2 text-destructive"
                onClick={handleDeleteFolder}
                type="button"
              >
                <LuTrash2 size={14} />
                <span>{t('common.delete')}</span>
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
  width,
}: FolderTreeProps) {
  const { t } = useTranslation()
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

  useEffect(() => {
    if (selectedFolder !== null && selectedFolder !== '') {
      setExpanded(prev => {
        const next = new Set(prev)
        next.add('')
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
    setExpanded(prev => {
      const next = new Set(prev)
      const pathParts = path.split(/[\\/]/).filter(Boolean)
      let accumulatedPath = ''
      next.add('')
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
    setExpanded(prev => {
      const next = new Set(prev)
      const pathParts = newPath.split(/[\\/]/).filter(Boolean)
      let accumulatedPath = ''
      next.add('')
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
    setExpanded(prev => {
      const next = new Set(prev)
      const pathParts = path === '' ? [] : path.split(/[\\/]/).filter(Boolean)
      let accumulatedPath = ''
      next.add('')
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
    <div
      className={`${width === undefined ? 'w-64' : ''} border-r border-border bg-sidebar flex flex-col flex-shrink-0 h-full`}
      style={width === undefined ? undefined : { width }}
    >
      <div
        className="border-b border-border flex-shrink-0 h-22 flex flex-col"
        style={{
          background:
            'linear-gradient(to bottom, var(--theme-accent-subtle), transparent)',
        }}
      >
        <div className="h-12 flex items-center justify-between px-4">
          <h2 className="text-heading-sm text-foreground flex items-center gap-2">
            <LuFolder size={16} style={{ color: 'var(--theme-accent)' }} />
            {t('sidebar.folders')}
          </h2>
          {onCreateFolder && (
            <SimpleTooltip content={t('common.create')}>
              <Button
                aria-label={t('common.create')}
                onClick={() => onCreateFolder(currentPath)}
                size="icon"
                variant="ghost"
              >
                <LuFolderPlus size={16} />
              </Button>
            </SimpleTooltip>
          )}
        </div>

        <div className="flex-1 min-h-0 flex items-center gap-2 px-4">
          {currentPath !== '' && (
            <SimpleTooltip content={t('common.back')}>
              <button
                className="p-1 hover:bg-accent rounded transition-colors flex-shrink-0"
                onClick={handleNavigateUp}
                type="button"
              >
                <LuArrowLeft size={14} />
              </button>
            </SimpleTooltip>
          )}
          <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0 flex-1">
            {breadcrumbs.map((crumb, index) => (
              <React.Fragment key={crumb.path}>
                {index > 0 && (
                  <span className="text-muted-foreground/60 flex-shrink-0">
                    /
                  </span>
                )}
                <button
                  className={`transition-colors flex-shrink-0 ${
                    index === breadcrumbs.length - 1
                      ? 'font-semibold'
                      : 'hover:underline'
                  }`}
                  onClick={() => handleBreadcrumbClick(crumb.path)}
                  onMouseEnter={e => {
                    if (index < breadcrumbs.length - 1) {
                      e.currentTarget.style.color = 'var(--theme-accent)'
                    }
                  }}
                  onMouseLeave={e => {
                    if (index < breadcrumbs.length - 1 && !crumb.isEllipsis) {
                      e.currentTarget.style.color = ''
                    }
                  }}
                  style={
                    crumb.isEllipsis || index === breadcrumbs.length - 1
                      ? { color: 'var(--theme-accent)' }
                      : undefined
                  }
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
          <SimpleTooltip content={t('folderTree.allNotesTitle')}>
            <button
              className={`sidebar-item flex justify-start items-center gap-2 mx-2 px-2 py-2 mb-2 cursor-pointer text-foreground ${
                showAllNotes ? 'font-semibold' : ''
              }`}
              data-active={showAllNotes}
              onClick={onShowAllNotes}
              style={{ width: 'calc(100% - 1rem)' }}
              type="button"
            >
              <span className="text-sm">{t('folderTree.allNotes')}</span>
              {totalNotes > 0 && (
                <span className="ml-auto text-xs px-2 py-0.5 rounded-full font-medium bg-muted text-muted-foreground">
                  {totalNotes}
                </span>
              )}
            </button>
          </SimpleTooltip>
        )}

        {animationDirection && prevPath !== '' && (
          <div
            className={`absolute inset-0 transition-all duration-300 ease-out ${
              animationDirection === 'forward'
                ? '-translate-x-full'
                : 'translate-x-full'
            }`}
          >
            {renderNode(prevNode)}
          </div>
        )}

        <div
          className="transition-all duration-300 ease-out"
          key={animationDirection ? currentPath : displayPath}
          style={{
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
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes slideInFromLeft {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
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
