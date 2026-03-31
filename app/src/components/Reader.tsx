import { useEffect, useRef, useState } from 'react'
import ePub, { Book as EPubBook, Rendition } from 'epubjs'
import type { Book } from '../types'
import { useBookStore } from '../store/bookStore'
import { ArrowLeft, ChevronLeft, ChevronRight, Menu, Settings, Maximize, Minimize, Bookmark, Search, Trash2 } from 'lucide-react'

interface ReaderProps {
  book: Book;
  onBack: () => void;
}

interface NavItem {
  id: string;
  href: string;
  label: string;
  subitems?: NavItem[];
}

const THEMES = {
  light: { background: '#ffffff', color: '#333333' },
  sepia: { background: '#fdf6e3', color: '#433422' },
  dark:  { background: '#1e1e1e', color: '#cccccc' }
}
type ThemeKey = keyof typeof THEMES;

const FONTS = [
  { name: 'System Default', value: 'system-ui, sans-serif' },
  { name: 'Serif', value: 'Georgia, serif' },
  { name: 'Monospace', value: 'Consolas, monospace' }
]

export function Reader({ book: initialBook, onBack }: ReaderProps) {
  const viewerRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<EPubBook | null>(null)
  const renditionRef = useRef<Rendition | null>(null)
  
  // Zustand Store
  const updateBookProgress = useBookStore(state => state.updateBookProgress)
  const addBookmarkStore = useBookStore(state => state.addBookmark)
  const removeBookmarkStore = useBookStore(state => state.removeBookmark)
  const currentBook = useBookStore(state => state.books.find(b => b.id === initialBook.id)) || initialBook

  // State
  const [toc, setToc] = useState<NavItem[]>([])
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<'TOC' | 'BOOKMARK' | 'SEARCH'>('TOC')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  
  const [fontSize, setFontSize] = useState(100)
  const [lineHeight, setLineHeight] = useState(1.5)
  const [fontFamily, setFontFamily] = useState(FONTS[0].value)
  const [currentTheme, setCurrentTheme] = useState<ThemeKey>('sepia')

  // Phase 5: Immersion, Progress, Bookmark & Search
  const [isIdle, setIsIdle] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [progress, setProgress] = useState(0)
  const [isLocationsReady, setIsLocationsReady] = useState(false)
  const [currentLocationCfi, setCurrentLocationCfi] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [isSearching, setIsSearching] = useState(false)
  
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null)
  const bookmarks = currentBook.bookmarks || []
  const isBookmarked = bookmarks.some(b => currentLocationCfi && b.cfi === currentLocationCfi)

  // Auto-hide UI on idle
  useEffect(() => {
    const resetIdleTimer = () => {
      setIsIdle(false)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      idleTimerRef.current = setTimeout(() => {
        if (!isSidebarOpen && !isSettingsOpen) {
          setIsIdle(true)
        }
      }, 3000)
    }

    document.addEventListener('mousemove', resetIdleTimer)
    document.addEventListener('keydown', resetIdleTimer)
    resetIdleTimer() 
    return () => {
      document.removeEventListener('mousemove', resetIdleTimer)
      document.removeEventListener('keydown', resetIdleTimer)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
  }, [isSidebarOpen, isSettingsOpen])

  // Fullscreen tracking
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => console.error(err))
    } else {
      document.exitFullscreen()
    }
  }

  useEffect(() => {
    let isMounted = true

    const initBook = async () => {
      try {
        const fileBuffer = await window.electronAPI.readFile(currentBook.filePath)
        if (!fileBuffer || !isMounted) return

        const arrayBuffer = fileBuffer.buffer.slice(
          fileBuffer.byteOffset,
          fileBuffer.byteOffset + fileBuffer.byteLength
        )

        const epubBook = ePub(arrayBuffer as ArrayBuffer)
        bookRef.current = epubBook

        await epubBook.ready

        // Generate locations for progress bar
        epubBook.locations.generate(1600).then(() => {
          if (isMounted) setIsLocationsReady(true)
        }).catch(err => console.error("Error generating locations:", err))

        if (viewerRef.current) {
          const rendition = epubBook.renderTo(viewerRef.current, {
            width: '100%',
            height: '100%',
            spread: 'none',
            allowScriptedContent: true
          })
          renditionRef.current = rendition

          // Register Themes
          rendition.themes.register('light', { body: THEMES.light });
          rendition.themes.register('sepia', { body: THEMES.sepia });
          rendition.themes.register('dark', { body: THEMES.dark });
          rendition.themes.select(currentTheme);
          rendition.themes.fontSize(fontSize + "%");
          rendition.themes.override('line-height', lineHeight.toString());
          rendition.themes.override('font-family', fontFamily);

          // Move to last reading pos or start
          if (currentBook.lastReadCfi) {
            await rendition.display(currentBook.lastReadCfi)
          } else {
            await rendition.display()
          }

          // Track progress & locate CFI
          rendition.on('relocated', (location: any) => {
            if (!isMounted) return;
            setCurrentLocationCfi(location.start.cfi)
            updateBookProgress(currentBook.id, location.start.cfi)

            if (epubBook.locations.length() > 0) {
              const pct = epubBook.locations.percentageFromCfi(location.start.cfi)
              setProgress(pct * 100)
            }
          })

          // Extract TOC
          epubBook.loaded.navigation.then(nav => {
            if (isMounted) {
              setToc(nav.toc as NavItem[])
            }
          })
        }

        // Key bindings for navigation & shortcuts
        const handleKeyUp = (e: KeyboardEvent | Event) => {
          const keyboardEvent = e as KeyboardEvent;
          if (['INPUT', 'TEXTAREA'].includes((keyboardEvent.target as HTMLElement).tagName)) return;

          switch (keyboardEvent.key) {
            case 'ArrowLeft':
            case 'PageUp':
              renditionRef.current?.prev()
              break;
            case 'ArrowRight':
            case 'PageDown':
              renditionRef.current?.next()
              break;
            case ' ':
              if (keyboardEvent.shiftKey) {
                renditionRef.current?.prev()
              } else {
                renditionRef.current?.next()
              }
              break;
            case 'Escape':
              if (document.fullscreenElement) {
                document.exitFullscreen()
              } else {
                onBack()
              }
              break;
            case 'F11':
              keyboardEvent.preventDefault()
              toggleFullscreen()
              break;
          }
        }
        
        document.addEventListener('keyup', handleKeyUp)
        renditionRef.current?.on('keyup', handleKeyUp)

        // Mouse wheel bindings for navigation
        const handleWheel = (e: WheelEvent) => {
          if (e.deltaY > 0) renditionRef.current?.next()
          else if (e.deltaY < 0) renditionRef.current?.prev()
        }
        
        document.addEventListener('wheel', handleWheel)

        renditionRef.current?.hooks.content.register((contents: any) => {
          const el = contents.document.documentElement;
          if (el) {
            el.addEventListener('wheel', (e: WheelEvent) => {
              e.preventDefault();
              handleWheel(e);
            });
            el.addEventListener('keyup', (e: KeyboardEvent) => {
               handleKeyUp(e);
            });
            el.addEventListener('mousemove', () => {
               document.dispatchEvent(new Event('mousemove'));
            });
          }
        });

        return () => {
          document.removeEventListener('keyup', handleKeyUp)
          document.removeEventListener('wheel', handleWheel)
        }
      } catch (e) {
        console.error('Reader init error:', e)
      }
    }

    initBook()

    return () => {
      isMounted = false
      if (bookRef.current) {
        bookRef.current.destroy()
      }
    }
  }, [currentBook.filePath])

  // Apply visual changes dynamically
  useEffect(() => {
    if (renditionRef.current) {
      renditionRef.current.themes.select(currentTheme)
      renditionRef.current.themes.fontSize(fontSize + "%")
      renditionRef.current.themes.override('line-height', lineHeight.toString())
      renditionRef.current.themes.override('font-family', fontFamily)
    }
  }, [currentTheme, fontSize, lineHeight, fontFamily])


  // --- Actions ---

  const handleTocClick = (href: string) => {
    renditionRef.current?.display(href)
    // Optional: auto-close sidebar on mobile only
    if (window.innerWidth < 1024) setIsSidebarOpen(false)
  }

  const toggleBookmark = async () => {
    if (!currentLocationCfi) return;
    if (isBookmarked) {
      removeBookmarkStore(currentBook.id, currentLocationCfi)
    } else {
      let text = '书签 ' + new Date().toLocaleTimeString()
      try {
        if (bookRef.current) {
          const currentRange = await bookRef.current.getRange(currentLocationCfi);
          if (currentRange) text = currentRange.toString().trim().slice(0, 40) + '...';
        }
      } catch (e) { console.error('Failed to extract text for bookmark', e) }
      
      addBookmarkStore(currentBook.id, {
        cfi: currentLocationCfi,
        text: text || "未知位置书签",
        label: "进度: " + progress.toFixed(1) + "%",
        time: Date.now()
      })
    }
  }

  const handleSearch = async () => {
    const q = searchQuery.trim()
    if (!q || !bookRef.current) return
    setIsSearching(true)
    setSearchResults([])
    
    try {
      const book = bookRef.current
      const spineItems = (book.spine as any).spineItems || [];
      const searchTasks = spineItems.map((item: any) => 
        item.load(book.load.bind(book))
          .then(() => item.find(q))
          .finally(() => item.unload())
      )
      
      const resultsArray = await Promise.all(searchTasks)
      const flatResults = resultsArray.flat().filter(Boolean)
      setSearchResults(flatResults)
    } catch (e) {
      console.error("Search failed: ", e)
    } finally {
      setIsSearching(false)
    }
  }

  // --- Render ---

  const renderToc = (items: NavItem[], depth = 0) => {
    return items.map(item => (
      <div key={item.id}>
        <button
          className={'w-full text-left py-2 px-4 hover:bg-black/5 transition text-sm ' + (depth > 0 ? 'opacity-80' : 'font-medium')}
          style={{ paddingLeft: (depth * 1 + 1) + 'rem' }}
          onClick={() => handleTocClick(item.href)}
        >
          {item.label}
        </button>
        {item.subitems && item.subitems.length > 0 && renderToc(item.subitems, depth + 1)}
      </div>
    ))
  }

  const containerBg = currentTheme === 'light' ? 'bg-white' : currentTheme === 'sepia' ? 'bg-[#FDF6E3]' : 'bg-[#18181A]'
  const isDark = currentTheme === 'dark'

  return (
    <div className={'flex flex-col h-screen overflow-hidden transition-colors duration-300 ' + containerBg + (isDark ? ' text-white' : ' text-black')}>
      {/* Top Bar (Auto-hides in Immersive Mode) */}
      <div className={'absolute top-0 left-0 right-0 h-14 flex items-center justify-between px-4 z-20 shrink-0 select-none transition-all duration-500 ' + (isIdle ? ' -translate-y-full opacity-0' : ' translate-y-0 opacity-100') + (isDark ? ' bg-[#1e1e1e]/90 text-white shadow-md' : ' bg-white/90 shadow-sm backdrop-blur')}>
        <div className="flex items-center gap-4 w-1/3">
          <button onClick={onBack} className="p-2 hover:bg-black/5 hover:text-blue-500 rounded-full transition" title="返回 (Esc)">
            <ArrowLeft size={20} />
          </button>
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)} 
            className={'p-2 hover:bg-black/5 hover:text-blue-500 rounded-full transition ' + (isSidebarOpen ? 'bg-black/5 text-blue-500' : '')}
            title="目录"
          >
            <Menu size={20} />
          </button>
        </div>

        <span className="font-medium truncate text-center flex-1">{currentBook.title}</span>
        
        <div className="flex items-center justify-end w-1/3 gap-1 relative">
          <button 
            onClick={toggleBookmark} 
            className={'p-2 hover:bg-black/5 rounded-full transition ' + (isBookmarked ? 'text-red-500 hover:text-red-600' : 'hover:text-red-400')} 
            title="添加/取消书签"
          >
            <Bookmark size={20} fill={isBookmarked ? "currentColor" : "none"} />
          </button>

          <button onClick={toggleFullscreen} className="p-2 hover:bg-black/5 rounded-full transition" title="全屏 (F11)">
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>

          <button 
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            className={'p-2 hover:bg-black/5 rounded-full transition ' + (isSettingsOpen ? 'bg-black/5 text-blue-500' : '')}
            title="阅读设置"
          >
            <Settings size={20} />
          </button>

          {/* Settings Dropdown */}
          {isSettingsOpen && (
            <div className={'absolute top-12 right-0 w-72 rounded-xl shadow-2xl p-5 border z-50 flex flex-col gap-5 text-sm ' + (isDark ? 'bg-[#2a2a2a] border-gray-700' : 'bg-white border-gray-200')}>
              <div>
                <p className={'text-xs font-semibold mb-2 ' + (isDark ? 'text-gray-400' : 'text-gray-500')}>背景主题</p>
                <div className="flex gap-2">
                  <button onClick={() => setCurrentTheme('light')} className={'flex-1 py-1.5 rounded border flex justify-center items-center gap-1 bg-white text-black ' + (currentTheme === 'light' ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200')}>浅色</button>
                  <button onClick={() => setCurrentTheme('sepia')} className={'flex-1 py-1.5 rounded border flex justify-center items-center gap-1 bg-[#FDF6E3] text-[#433422] ' + (currentTheme === 'sepia' ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200')}>护眼</button>
                  <button onClick={() => setCurrentTheme('dark')} className={'flex-1 py-1.5 rounded border flex justify-center items-center gap-1 bg-[#1E1E1E] text-white ' + (currentTheme === 'dark' ? 'border-blue-500 ring-1 ring-blue-500' : 'border-transparent')}>夜间</button>
                </div>
              </div>
              
              <div className="flex gap-4">
                <div className="flex-1">
                  <p className={'text-xs font-semibold mb-2 ' + (isDark ? 'text-gray-400' : 'text-gray-500')}>字号 ({fontSize}%)</p>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setFontSize(Math.max(50, fontSize - 10))} className={'flex-1 py-1 rounded border ' + (isDark ? 'border-gray-600 hover:bg-gray-600' : 'border-gray-200 hover:bg-gray-50')}>-</button>
                    <button onClick={() => setFontSize(Math.min(200, fontSize + 10))} className={'flex-1 py-1 rounded border ' + (isDark ? 'border-gray-600 hover:bg-gray-600' : 'border-gray-200 hover:bg-gray-50')}>+</button>
                  </div>
                </div>
                <div className="flex-1">
                  <p className={'text-xs font-semibold mb-2 ' + (isDark ? 'text-gray-400' : 'text-gray-500')}>行距</p>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setLineHeight(Math.max(1, lineHeight - 0.2))} className={'flex-1 py-1 rounded border ' + (isDark ? 'border-gray-600 hover:bg-gray-600' : 'border-gray-200 hover:bg-gray-50')}>紧</button>
                    <button onClick={() => setLineHeight(Math.min(3, lineHeight + 0.2))} className={'flex-1 py-1 rounded border ' + (isDark ? 'border-gray-600 hover:bg-gray-600' : 'border-gray-200 hover:bg-gray-50')}>松</button>
                  </div>
                </div>
              </div>

              <div>
                <p className={'text-xs font-semibold mb-2 ' + (isDark ? 'text-gray-400' : 'text-gray-500')}>字体</p>
                <select 
                  value={fontFamily} 
                  onChange={(e) => setFontFamily(e.target.value)}
                  className={'w-full p-2 rounded border focus:outline-none focus:ring-1 focus:ring-blue-500 ' + (isDark ? 'bg-[#333] border-gray-600' : 'bg-white border-gray-200')}
                >
                  {FONTS.map(f => (
                    <option key={f.name} value={f.value}>{f.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden relative pt-14 pb-12">
        {/* Sidebar (TOC / Bookmark / Search) */}
        <div 
          className={'absolute lg:relative z-40 h-full w-72 lg:w-80 shadow-2xl lg:shadow-none border-r transition-transform duration-300 flex flex-col ' + (isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:-translate-x-full lg:hidden') + (isDark ? ' bg-[#222222] border-gray-800' : ' bg-[#FAF9F8] border-gray-200')}
        >
          {/* Sidebar Tabs */}
          <div className={'flex text-sm text-center border-b font-medium ' + (isDark ? 'border-gray-700' : 'border-gray-200')}>
            <button onClick={() => setSidebarTab('TOC')} className={`flex-1 py-3 transition ${sidebarTab === 'TOC' ? (isDark ? 'text-white border-b-2 border-white' : 'text-black border-b-2 border-black') : 'opacity-50'}`}>目录</button>
            <button onClick={() => setSidebarTab("BOOKMARK")} className={`flex-1 py-3 transition flex justify-center items-center gap-1 ${sidebarTab === "BOOKMARK" ? (isDark ? "text-white border-b-2 border-white" : "text-black border-b-2 border-black") : "opacity-50"}`}>书签({bookmarks.length})</button>
            <button onClick={() => setSidebarTab('SEARCH')} className={`flex-1 py-3 transition ${sidebarTab === 'SEARCH' ? (isDark ? 'text-white border-b-2 border-white' : 'text-black border-b-2 border-black') : 'opacity-50'}`}>全文搜索</button>
          </div>

          {/* Sidebar Content */}
          <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-400">
            {sidebarTab === 'TOC' && (
              <div className="py-2">
                {toc.length > 0 ? renderToc(toc) : <p className="p-4 text-sm opacity-50 text-center">暂无目录数据</p>}
              </div>
            )}
            
            {sidebarTab === 'BOOKMARK' && (
              <div className="p-4 flex flex-col gap-3">
                {bookmarks.length === 0 ? (
                  <p className="text-sm opacity-50 text-center mt-10">暂无书签，点击右上角保存</p>
                ) : (
                  bookmarks.sort((a,b) => b.time - a.time).map(bm => (
                    <div key={bm.cfi} className={'p-3 rounded-lg border group relative ' + (isDark ? 'bg-[#333] border-gray-700' : 'bg-white border-gray-200 shadow-sm')}>
                       <div className="cursor-pointer" onClick={() => handleTocClick(bm.cfi)}>
                          <p className="text-xs opacity-70 mb-1">{bm.label} • {new Date(bm.time).toLocaleDateString()}</p>
                          <p className="text-sm line-clamp-3">{bm.text}</p>
                       </div>
                       <button onClick={() => removeBookmarkStore(currentBook.id, bm.cfi)} className="absolute top-2 right-2 p-1.5 opacity-0 group-hover:opacity-100 bg-red-100 text-red-600 rounded-full hover:bg-red-200 transition">
                         <Trash2 size={14} />
                       </button>
                    </div>
                  ))
                )}
              </div>
            )}

            {sidebarTab === 'SEARCH' && (
              <div className="p-4 flex flex-col h-full">
                <div className="flex gap-2 mb-4">
                  <input 
                    type="text" 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="输入关键词..."
                    className={'flex-1 w-full p-2 text-sm rounded border focus:outline-none focus:ring-1 focus:ring-blue-500 ' + (isDark ? 'bg-[#333] border-gray-700' : 'bg-white border-gray-300')}
                  />
                  <button 
                    onClick={handleSearch} 
                    disabled={isSearching || !searchQuery.trim()}
                    className={'px-3 rounded text-white flex items-center justify-center transition ' + (isSearching ? 'bg-gray-400' : 'bg-blue-500 hover:bg-blue-600')}
                  >
                    <Search size={16} />
                  </button>
                </div>
                
                <div className="flex-1">
                  {isSearching ? (
                    <p className="text-sm opacity-60 text-center mt-10">全书检索中，请稍候...</p>
                  ) : searchResults.length > 0 ? (
                    <div className="flex flex-col gap-2">
                       <p className="text-xs opacity-60 mb-2">找到 {searchResults.length} 条结果</p>
                       {searchResults.map((res, idx) => (
                         <div key={idx} onClick={() => handleTocClick(res.cfi)} className={'p-2 rounded cursor-pointer transition ' + (isDark ? 'hover:bg-[#333]' : 'hover:bg-black/5')}>
                            <p className="text-sm opacity-90 line-clamp-3" dangerouslySetInnerHTML={{ __html: res.excerpt.replace(new RegExp('(' + searchQuery + ')', 'gi'), '<mark class="bg-yellow-200 text-black px-0.5 rounded">$1</mark>') }}></p>
                         </div>
                       ))}
                    </div>
                  ) : (searchQuery && !isSearching) ? (
                    <p className="text-sm opacity-60 text-center mt-10">未找到相关结果</p>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Backdrop for mobile sidebar */}
        {isSidebarOpen && (
          <div className="absolute inset-0 bg-black/20 z-30 lg:hidden" onClick={() => setIsSidebarOpen(false)} />
        )}

        {/* Reader Area */}
        <div className="flex-1 relative flex items-center justify-center">
          <button 
            onClick={() => renditionRef.current?.prev()}
            className={'absolute left-2 lg:left-6 z-10 p-2 rounded-full shadow transition hover:scale-105 duration-300 ' + (isIdle ? 'opacity-0' : 'opacity-100') + (isDark ? ' bg-[#2a2a2a] text-white hover:bg-[#3a3a3a] border border-gray-700' : ' bg-white text-black hover:bg-gray-50 border border-gray-200')}
          >
            <ChevronLeft size={32} />
          </button>
          
          <div className="w-full h-full max-w-4xl px-12 md:px-20 lg:px-24 flex items-center justify-center relative">
             {/* Use absolute inset to ensure epubjs takes full height nicely */}
             <div className="absolute inset-y-4 inset-x-12 md:inset-x-20 lg:inset-x-24" ref={viewerRef}></div>
          </div>

          <button 
            onClick={() => renditionRef.current?.next()}
            className={'absolute right-2 lg:right-6 z-10 p-2 rounded-full shadow transition hover:scale-105 duration-300 ' + (isIdle ? 'opacity-0' : 'opacity-100') + (isDark ? ' bg-[#2a2a2a] text-white hover:bg-[#3a3a3a] border border-gray-700' : ' bg-white text-black hover:bg-gray-50 border border-gray-200')}
          >
            <ChevronRight size={32} />
          </button>
        </div>
      </div>

      {/* Bottom Progress Bar */}
      <div className={'absolute bottom-0 left-0 right-0 h-12 flex items-center z-20 transition-all duration-500 ' + (isIdle ? ' translate-y-full opacity-0' : ' translate-y-0 opacity-100') + (isDark ? ' bg-[#1e1e1e]/90 border-gray-800' : ' bg-white/90 border-gray-200 backdrop-blur') + ' border-t'}>
        <div className="w-full max-w-4xl mx-auto flex items-center gap-4 px-6 lg:px-12">
          <span className="text-xs w-12 text-right opacity-80">{progress.toFixed(1)}%</span>
          <input 
            type="range" 
            min="0" 
            max="100" 
            step="0.1" 
            value={progress}
            disabled={!isLocationsReady}
            onChange={(e) => {
              const val = parseFloat(e.target.value)
              setProgress(val)
              const cfi = bookRef.current?.locations.cfiFromPercentage(val / 100)
              if (cfi) renditionRef.current?.display(cfi)
            }}
            className={'flex-1 h-1.5 rounded-lg appearance-none cursor-pointer ' + (isDark ? 'bg-gray-600 accent-blue-500' : 'bg-gray-300')}
            title={isLocationsReady ? "拖动跳转" : "正在解析进度..."}
          />
        </div>
      </div>
    </div>
  )
}




