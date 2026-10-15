# Windows build fixes for whisper.cpp

if(CMAKE_HOST_WIN32 AND DEFINED ENV{TEMP})
	# The Vulkan shader compiler's nested CMake project goes past Windows' 260-character path limit lol
	string(MD5 _bc_hash "${CMAKE_BINARY_DIR}")
	string(SUBSTRING "${_bc_hash}" 0 10 _bc_hash)
	file(TO_CMAKE_PATH "$ENV{TEMP}/bc-cmake/${_bc_hash}" _bc_ep_base)
	set_property(DIRECTORY PROPERTY EP_BASE "${_bc_ep_base}")
endif()

if(CMAKE_GENERATOR MATCHES "Visual Studio")
	# The VS generator drops optimization flags for release builds for some reason
	set(CMAKE_C_FLAGS_RELEASE "/MD /O2 /Ob2 /DNDEBUG" CACHE STRING "" FORCE)
	set(CMAKE_CXX_FLAGS_RELEASE "/MD /O2 /Ob2 /DNDEBUG" CACHE STRING "" FORCE)
endif()
