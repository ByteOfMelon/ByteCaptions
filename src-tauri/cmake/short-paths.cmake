# Passed to whisper.cpp's CMake build (as CMAKE_TOOLCHAIN_FILE, from .cargo/config.toml).
#
# The Vulkan backend builds its shader compiler as a nested CMake project inside Cargo's
# already deep OUT_DIR, which pushes MSBuild past Windows' 260-character path limit ("No
# CMAKE_C_COMPILER could be found"). Build nested projects under a short folder in %TEMP%
# instead, one per build directory so debug and release builds don't collide.
if(CMAKE_HOST_WIN32 AND DEFINED ENV{TEMP})
	string(MD5 _bc_hash "${CMAKE_BINARY_DIR}")
	string(SUBSTRING "${_bc_hash}" 0 10 _bc_hash)
	file(TO_CMAKE_PATH "$ENV{TEMP}/bc-cmake/${_bc_hash}" _bc_ep_base)
	set_property(DIRECTORY PROPERTY EP_BASE "${_bc_ep_base}")
endif()
